import * as dotenv from 'dotenv';
import * as cron from 'node-cron';
import { BaseAgent } from '../shared/BaseAgent';
import axios from 'axios';
import { 
  AgentConfig, 
  MemecoinData, 
  LiquidityData, 
  RiskData, 
  AlertSignal, 
  A2AMessagePayload, 
  DashboardData,
  ChartData 
} from '../types';
import { ExecutionEventBus } from '@a2a-js/sdk/server';
import { Message } from '@a2a-js/sdk';
import { v4 as uuidv4 } from 'uuid';
import express from 'express';
import path from 'path';

dotenv.config();

interface AggregatedTokenData {
  discovery: MemecoinData;
  yield: LiquidityData | null;
  risk: RiskData | null;
  alert: AlertSignal | null;
  lastUpdated: number;
}

interface InsightReport {
  id: string;
  title: string;
  summary: string;
  recommendations: string[];
  topTokens: Array<{
    symbol: string;
    address: string;
    score: number;
    reasoning: string;
  }>;
  marketTrends: {
    avgAPY: number;
    avgRisk: number;
    totalTVL: number;
    trendDirection: 'UP' | 'DOWN' | 'STABLE';
  };
  timestamp: number;
}

export class PersonalAssistantAgent extends BaseAgent {
  private groqApiKey: string;
  private aggregatedData: Map<string, AggregatedTokenData> = new Map();
  private insights: InsightReport[] = [];
  private dashboardApp: express.Application;
  private activityLog: A2AMessagePayload[] = [];
  
  constructor() {
    const config: AgentConfig = {
      id: 'personal-assistant',
      name: 'Personal Assistant Agent',
      description: 'Aggregates all data and builds analytics dashboards with chat interface',
      port: parseInt(process.env.ASSISTANT_AGENT_PORT || '4006'),
      baseUrl: `http://localhost:${process.env.ASSISTANT_AGENT_PORT || '4006'}`,
      skills: [
        {
          id: 'data-aggregation',
          name: 'Data Aggregation',
          description: 'Aggregate data from all agents',
          tags: ['aggregation', 'data', 'analysis']
        },
        {
          id: 'insight-generation',
          name: 'Insight Generation',
          description: 'Generate AI-powered insights and summaries',
          tags: ['ai', 'insights', 'llm']
        },
        {
          id: 'dashboard-interface',
          name: 'Dashboard Interface',
          description: 'Provide web dashboard and chat interface',
          tags: ['dashboard', 'web', 'interface']
        },
        {
          id: 'trend-analysis',
          name: 'Trend Analysis',
          description: 'Analyze market trends and patterns',
          tags: ['trends', 'analysis', 'patterns']
        }
      ]
    };

    super(config);
    
    // Initialize Groq API key
    this.groqApiKey = process.env.GROQ_API_KEY || '';
    if (!this.groqApiKey) {
      throw new Error('GROQ_API_KEY environment variable is required');
    }

    // Create dashboard app
    this.dashboardApp = express();
    this.setupDashboard();
  }

  private async callGroqAPI(systemMessage: string, userMessage: string): Promise<string> {
    try {
      const response = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model: 'llama-3.1-8b-instant',
          messages: [
            { role: 'system', content: systemMessage },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 1000
        },
        {
          headers: {
            'Authorization': `Bearer ${this.groqApiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return response.data.choices[0].message.content;
    } catch (error: any) {
      console.error('❌ Groq API error:', error.response?.data || error.message);
      throw new Error('Failed to get response from Groq API');
    }
  }

  async initialize(): Promise<void> {
    await super.initialize();
    
    console.log('🧠 Personal Assistant Agent initialized with Groq LLM');
    console.log('📊 Dashboard available at http://localhost:' + this.config.port + '/dashboard');
    
    // Start periodic insight generation
    this.startPeriodicInsightGeneration();
    
    // Setup dashboard routes
    this.startDashboardServer();
  }

  private setupDashboard(): void {
    this.dashboardApp.use(express.json());
    this.dashboardApp.use(express.static('public'));

    // Dashboard route
    this.dashboardApp.get('/dashboard', (req, res) => {
      res.send(this.generateDashboardHTML());
    });

    // API routes
    this.dashboardApp.get('/api/dashboard-data', (req, res) => {
      res.json(this.getDashboardData());
    });

    this.dashboardApp.get('/api/insights', (req, res) => {
      res.json(this.insights);
    });

    this.dashboardApp.get('/api/chart-data/:type', (req, res) => {
      const chartType = req.params.type;
      res.json(this.getChartData(chartType));
    });

    this.dashboardApp.post('/api/chat', async (req, res) => {
      try {
        const { message } = req.body;
        const response = await this.handleChatMessage(message);
        res.json({ response });
      } catch (error) {
        res.status(500).json({ error: 'Chat processing failed' });
      }
    });

    this.dashboardApp.get('/api/token/:address', (req, res) => {
      const tokenAddress = req.params.address;
      const tokenData = this.aggregatedData.get(tokenAddress);
      
      if (tokenData) {
        res.json(tokenData);
      } else {
        res.status(404).json({ error: 'Token not found' });
      }
    });
  }

  private startDashboardServer(): void {
    const dashboardPort = this.config.port + 100; // Offset to avoid conflicts
    this.dashboardApp.listen(dashboardPort, () => {
      console.log(`📊 Dashboard server started on port ${dashboardPort}`);
      console.log(`🌐 Access dashboard at: http://localhost:${dashboardPort}/dashboard`);
    });
  }

  private startPeriodicInsightGeneration(): void {
    // Generate insights every 30 minutes
    cron.schedule('*/30 * * * *', async () => {
      console.log('🔄 Generating periodic insights...');
      await this.generateInsights();
    });

    // Generate daily summary report
    cron.schedule('0 7 * * *', async () => {
      console.log('📊 Generating daily summary report...');
      await this.generateDailySummary();
    });

    console.log('⏰ Scheduled insight generation every 30 minutes');
  }

  private async generateInsights(): Promise<void> {
    try {
      console.log('🧠 Generating AI-powered insights...');
      
      const tokenData = Array.from(this.aggregatedData.values());
      if (tokenData.length === 0) {
        console.log('📊 No data available for insight generation');
        return;
      }

      // Prepare data summary for LLM
      const dataSummary = this.prepareDatasummary(tokenData);
      
      const systemPrompt = `You are MemeSentinel AI, an expert DeFi analyst. Analyze memecoin data and provide insights.

Please provide:
1. A brief market summary
2. Top 3 recommended tokens with reasoning  
3. Market trend analysis
4. Risk warnings if any

Focus on actionable insights for DeFi investors.`;

      const userPrompt = `Analyze the following memecoin data:

${dataSummary}`;

      const response = await this.callGroqAPI(systemPrompt, userPrompt);
      const insights = this.parseInsightsFromLLM(response, tokenData);
      
      this.insights.unshift(insights);
      
      // Keep only last 10 insights
      if (this.insights.length > 10) {
        this.insights = this.insights.slice(0, 10);
      }

      console.log(`✅ Generated new insights: ${insights.title}`);
      
      // Broadcast insights to other agents
      const payload: A2AMessagePayload = {
        messageType: 'alert_decision',
        data: insights as any,
        agentId: this.config.id,
        timestamp: Date.now(),
        contextId: 'insights-broadcast'
      };

      await this.sendA2AMessage(payload);
    } catch (error) {
      console.error('❌ Error generating insights:', error);
    }
  }

  private prepareDatasummary(tokenData: AggregatedTokenData[]): string {
    const summary = tokenData.slice(0, 10).map(token => {
      const apy = token.yield?.apy || 0;
      const risk = token.risk?.riskScore || 100;
      const alert = token.alert?.alertType || 'NONE';
      
      return `${token.discovery.symbol}: APY ${apy.toFixed(1)}%, Risk ${risk}/100, Alert: ${alert}`;
    }).join('\n');

    const stats = this.calculateMarketStats(tokenData);
    
    return `
Market Overview:
- Total tokens tracked: ${tokenData.length}
- Average APY: ${stats.avgAPY.toFixed(1)}%
- Average Risk Score: ${stats.avgRisk.toFixed(1)}/100
- Total TVL: $${stats.totalTVL.toLocaleString()}

Top Tokens:
${summary}
    `;
  }

  private parseInsightsFromLLM(llmResponse: string, tokenData: AggregatedTokenData[]): InsightReport {
    // Parse LLM response and create structured insight report
    const stats = this.calculateMarketStats(tokenData);
    
    // Extract top tokens based on score (APY/Risk ratio)
    const topTokens = tokenData
      .filter(token => token.yield && token.risk)
      .map(token => ({
        symbol: token.discovery.symbol,
        address: token.discovery.address,
        score: token.yield!.apy / (token.risk!.riskScore + 1), // Simple scoring
        reasoning: `APY: ${token.yield!.apy.toFixed(1)}%, Risk: ${token.risk!.riskScore}/100`
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return {
      id: uuidv4(),
      title: `Market Insights - ${new Date().toLocaleDateString()}`,
      summary: llmResponse.split('\n')[0] || 'AI analysis of current memecoin market conditions',
      recommendations: this.extractRecommendations(llmResponse),
      topTokens,
      marketTrends: {
        avgAPY: stats.avgAPY,
        avgRisk: stats.avgRisk,
        totalTVL: stats.totalTVL,
        trendDirection: this.determineTrendDirection(tokenData)
      },
      timestamp: Date.now()
    };
  }

  private extractRecommendations(llmResponse: string): string[] {
    // Simple extraction - in production, use better NLP
    const lines = llmResponse.split('\n');
    return lines
      .filter(line => line.includes('recommend') || line.includes('suggest') || line.includes('consider'))
      .slice(0, 3)
      .map(line => line.trim());
  }

  private calculateMarketStats(tokenData: AggregatedTokenData[]) {
    const validTokens = tokenData.filter(token => token.yield && token.risk);
    
    if (validTokens.length === 0) {
      return { avgAPY: 0, avgRisk: 0, totalTVL: 0 };
    }

    const avgAPY = validTokens.reduce((sum, token) => sum + (token.yield!.apy || 0), 0) / validTokens.length;
    const avgRisk = validTokens.reduce((sum, token) => sum + (token.risk!.riskScore || 0), 0) / validTokens.length;
    const totalTVL = validTokens.reduce((sum, token) => sum + (token.yield!.tvl || 0), 0);

    return { avgAPY, avgRisk, totalTVL };
  }

  private determineTrendDirection(tokenData: AggregatedTokenData[]): 'UP' | 'DOWN' | 'STABLE' {
    // Simple trend analysis based on recent discoveries
    const recentTokens = tokenData
      .filter(token => token.discovery.discoveredAt && Date.now() - token.discovery.discoveredAt < 3600000) // Last hour
      .length;

    if (recentTokens > 5) return 'UP';
    if (recentTokens < 2) return 'DOWN';
    return 'STABLE';
  }

  private async handleChatMessage(message: string): Promise<string> {
    try {
      console.log(`💬 Chat message received: ${message}`);
      
      // Prepare context with current data
      const context = this.prepareChatContext();
      
      const systemMessage = `You are MemeSentinel AI, an expert DeFi assistant specializing in memecoin analysis, powered by Groq.
        
Current data context:
${context}

Provide helpful, accurate responses based on the available data. If asked about specific tokens, provide their current metrics.`;

      const response = await this.callGroqAPI(systemMessage, message);
      return response;
    } catch (error) {
      console.error('❌ Error handling chat message:', error);
      return 'Sorry, I encountered an error processing your request. Please try again.';
    }
  }

  private prepareChatContext(): string {
    const tokenData = Array.from(this.aggregatedData.values()).slice(0, 5);
    const recentInsights = this.insights.slice(0, 2);
    
    let context = `MemeSentinel AI - Real-time meme token analysis dashboard\n`;
    context += `Currently tracking ${tokenData.length} tokens with live yield and risk data.\n\n`;
    
    if (tokenData.length > 0) {
      context += 'ACTIVE TOKENS:\n';
      tokenData.forEach(token => {
        const apy = token.yield?.apy || 0;
        const risk = token.risk?.riskScore || 0;
        const alert = token.alert?.alertType || 'NONE';
        const tvl = token.yield?.tvl || 0;
        const volume24h = token.yield?.volume24h || 0;
        
        context += `• ${token.discovery.symbol} (${token.discovery.address.slice(0,8)}...)\n`;
        context += `  APY: ${apy.toFixed(2)}% | Risk Score: ${risk}/100 | Alert: ${alert}\n`;
        context += `  TVL: $${tvl.toLocaleString()} | 24h Volume: $${volume24h.toLocaleString()}\n`;
        context += `  Price: $${token.discovery.priceUSD || 0} | Market Cap: $${(token.discovery.marketCap || 0).toLocaleString()}\n\n`;
      });
    }

    if (recentInsights.length > 0) {
      context += 'RECENT AI INSIGHTS:\n';
      recentInsights.forEach(insight => {
        context += `• ${insight.title}\n  ${insight.summary}\n\n`;
      });
    }

    context += `All agents operational. Data refreshed every 30 seconds.\n`;
    context += `Use this rich data to provide intelligent analysis and recommendations.`;

    return context;
  }

  private getDashboardData(): DashboardData {
    const tokenData = Array.from(this.aggregatedData.values());
    const activeAlerts = tokenData
      .map(token => token.alert)
      .filter(alert => alert !== null) as AlertSignal[];

    const topPerformers = tokenData
      .filter(token => token.yield && token.risk)
      .map(token => ({
        symbol: token.discovery.symbol,
        address: token.discovery.address,
        apy: token.yield!.apy,
        riskScore: token.risk!.riskScore,
        growth24h: Math.random() * 20 - 10 // Mock growth data
      }))
      .sort((a, b) => b.apy - a.apy)
      .slice(0, 5);

    const riskHeatmap = tokenData
      .filter(token => token.yield && token.risk)
      .map(token => ({
        symbol: token.discovery.symbol,
        risk: token.risk!.riskScore,
        yield: token.yield!.apy
      }));

    return {
      totalTokensTracked: tokenData.length,
      activeAlerts,
      topPerformers,
      riskHeatmap,
      recentActivity: this.activityLog.slice(0, 10)
    };
  }

  private getChartData(type: string): ChartData {
    const tokenData = Array.from(this.aggregatedData.values());
    
    switch (type) {
      case 'apy-distribution':
        return this.generateAPYDistributionChart(tokenData);
      case 'risk-yield-scatter':
        return this.generateRiskYieldScatterChart(tokenData);
      case 'timeline':
        return this.generateTimelineChart(tokenData);
      default:
        return { labels: [], datasets: [] };
    }
  }

  private generateAPYDistributionChart(tokenData: AggregatedTokenData[]): ChartData {
    const apyRanges = ['0-10%', '10-25%', '25-50%', '50-100%', '100%+'];
    const counts = [0, 0, 0, 0, 0];

    tokenData.forEach(token => {
      if (!token.yield) return;
      const apy = token.yield.apy;
      
      if (apy <= 10) counts[0]++;
      else if (apy <= 25) counts[1]++;
      else if (apy <= 50) counts[2]++;
      else if (apy <= 100) counts[3]++;
      else counts[4]++;
    });

    return {
      labels: apyRanges,
      datasets: [{
        label: 'Token Count',
        data: counts,
        borderColor: 'rgb(75, 192, 192)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)'
      }]
    };
  }

  private generateRiskYieldScatterChart(tokenData: AggregatedTokenData[]): ChartData {
    const validTokens = tokenData.filter(token => token.yield && token.risk);
    
    return {
      labels: validTokens.map(token => token.discovery.symbol),
      datasets: [{
        label: 'Risk vs Yield',
        data: validTokens.map(token => token.yield!.apy),
        borderColor: 'rgb(255, 99, 132)',
        backgroundColor: 'rgba(255, 99, 132, 0.2)'
      }]
    };
  }

  private generateTimelineChart(tokenData: AggregatedTokenData[]): ChartData {
    // Group tokens by discovery time (last 24 hours)
    const hourlyData = new Array(24).fill(0);
    const now = Date.now();
    
    tokenData.forEach(token => {
      if (token.discovery.discoveredAt) {
        const hoursAgo = Math.floor((now - token.discovery.discoveredAt) / 3600000);
        if (hoursAgo < 24) {
          hourlyData[23 - hoursAgo]++;
        }
      }
    });

    const labels = Array.from({ length: 24 }, (_, i) => `${i}:00`);

    return {
      labels,
      datasets: [{
        label: 'Tokens Discovered',
        data: hourlyData,
        borderColor: 'rgb(54, 162, 235)',
        backgroundColor: 'rgba(54, 162, 235, 0.2)'
      }]
    };
  }

  private generateDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>MemeSentinel Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .header { text-align: center; margin-bottom: 30px; }
        .dashboard { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .card { background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        .chart-container { position: relative; height: 300px; }
        .alert-list { max-height: 200px; overflow-y: auto; }
        .alert-item { padding: 10px; margin: 5px 0; border-radius: 4px; }
        .alert-buy { background: #d4edda; border-left: 4px solid #28a745; }
        .alert-watch { background: #fff3cd; border-left: 4px solid #ffc107; }
        .alert-avoid { background: #f8d7da; border-left: 4px solid #dc3545; }
        .chat-container { margin-top: 20px; }
        .chat-input { width: 70%; padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
        .chat-button { width: 25%; padding: 10px; background: #007bff; color: white; border: none; border-radius: 4px; }
        .chat-response { margin-top: 10px; padding: 10px; background: #e9ecef; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🧠 MemeSentinel Dashboard</h1>
        <p>AI-Powered Memecoin Intelligence (Powered by Groq)</p>
    </div>
    
    <div class="dashboard">
        <div class="card">
            <h3>📊 Market Overview</h3>
            <div id="overview-stats">Loading...</div>
        </div>
        
        <div class="card">
            <h3>🚨 Active Alerts</h3>
            <div id="alerts-list" class="alert-list">Loading...</div>
        </div>
        
        <div class="card">
            <h3>📈 APY Distribution</h3>
            <div class="chart-container">
                <canvas id="apy-chart"></canvas>
            </div>
        </div>
        
        <div class="card">
            <h3>⚠️ Risk vs Yield</h3>
            <div class="chart-container">
                <canvas id="risk-yield-chart"></canvas>
            </div>
        </div>
    </div>
    
    <div class="card chat-container">
        <h3>💬 Chat with MemeSentinel AI (Groq-Powered)</h3>
        <input type="text" id="chat-input" class="chat-input" placeholder="Ask about memecoin trends, specific tokens, or market insights...">
        <button onclick="sendMessage()" class="chat-button">Send</button>
        <div id="chat-response" class="chat-response" style="display: none;"></div>
    </div>

    <script>
        // Load dashboard data
        async function loadDashboard() {
            try {
                const response = await fetch('/api/dashboard-data');
                const data = await response.json();
                
                // Update overview stats
                document.getElementById('overview-stats').innerHTML = \`
                    <p>Total Tokens: \${data.totalTokensTracked}</p>
                    <p>Active Alerts: \${data.activeAlerts.length}</p>
                    <p>Top Performers: \${data.topPerformers.length}</p>
                \`;
                
                // Update alerts
                const alertsHtml = data.activeAlerts.slice(0, 5).map(alert => 
                    \`<div class="alert-item alert-\${alert.alertType.toLowerCase()}">
                        <strong>\${alert.symbol}</strong> - \${alert.alertType} 
                        (Confidence: \${alert.confidence}%)
                    </div>\`
                ).join('');
                document.getElementById('alerts-list').innerHTML = alertsHtml || 'No active alerts';
                
                // Load charts
                loadCharts();
            } catch (error) {
                console.error('Error loading dashboard:', error);
            }
        }
        
        async function loadCharts() {
            // APY Distribution Chart
            const apyResponse = await fetch('/api/chart-data/apy-distribution');
            const apyData = await apyResponse.json();
            
            new Chart(document.getElementById('apy-chart'), {
                type: 'bar',
                data: apyData,
                options: { responsive: true, maintainAspectRatio: false }
            });
            
            // Risk-Yield Scatter Chart
            const riskResponse = await fetch('/api/chart-data/risk-yield-scatter');
            const riskData = await riskResponse.json();
            
            new Chart(document.getElementById('risk-yield-chart'), {
                type: 'line',
                data: riskData,
                options: { responsive: true, maintainAspectRatio: false }
            });
        }
        
        async function sendMessage() {
            const input = document.getElementById('chat-input');
            const message = input.value.trim();
            if (!message) return;
            
            const responseDiv = document.getElementById('chat-response');
            responseDiv.style.display = 'block';
            responseDiv.innerHTML = 'Thinking...';
            
            try {
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message })
                });
                
                const data = await response.json();
                responseDiv.innerHTML = data.response;
                input.value = '';
            } catch (error) {
                responseDiv.innerHTML = 'Error: ' + error.message;
            }
        }
        
        // Allow Enter key to send message
        document.getElementById('chat-input').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') sendMessage();
        });
        
        // Load dashboard on page load
        loadDashboard();
        
        // Refresh every 30 seconds
        setInterval(loadDashboard, 30000);
    </script>
</body>
</html>
    `;
  }

  private async generateDailySummary(): Promise<void> {
    try {
      console.log('📊 Generating daily summary...');
      
      const summary = await this.generateInsights();
      
      // Create a special daily summary payload
      const payload: A2AMessagePayload = {
        messageType: 'alert_decision',
        data: {
          type: 'DAILY_SUMMARY',
          insights: this.insights[0],
          timestamp: Date.now()
        } as any,
        agentId: this.config.id,
        timestamp: Date.now(),
        contextId: 'daily-summary'
      };

      await this.sendA2AMessage(payload);
    } catch (error) {
      console.error('❌ Error generating daily summary:', error);
    }
  }

  protected async processMessage(
    payload: A2AMessagePayload,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    try {
      // Log all messages for activity tracking
      this.activityLog.unshift(payload);
      if (this.activityLog.length > 100) {
        this.activityLog = this.activityLog.slice(0, 100);
      }

      switch (payload.messageType) {
        case 'token_discovery':
          await this.handleTokenDiscovery(payload, eventBus);
          break;
        
        case 'yield_report':
          await this.handleYieldReport(payload, eventBus);
          break;

        case 'risk_report':
          await this.handleRiskReport(payload, eventBus);
          break;

        case 'alert_decision':
          await this.handleAlertDecision(payload, eventBus);
          break;

        case 'settlement_request':
          await this.handleSettlementUpdate(payload, eventBus);
          break;

        default:
          console.log(`⚠️  Unknown message type: ${payload.messageType}`);
          break;
      }
    } catch (error) {
      console.error('❌ Error processing message:', error);
    }
  }

  private async handleTokenDiscovery(
    payload: A2AMessagePayload,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    try {
      const tokenData = payload.data as MemecoinData;
      
      console.log(`🔍 Aggregating discovery data for ${tokenData.symbol}`);

      // Initialize aggregated data
      this.aggregatedData.set(tokenData.address, {
        discovery: tokenData,
        yield: null,
        risk: null,
        alert: null,
        lastUpdated: Date.now()
      });

      const response: Message = {
        kind: 'message',
        messageId: uuidv4(),
        role: 'agent',
        parts: [{
          kind: 'text',
          text: `🧠 Personal Assistant tracking ${tokenData.symbol}. Awaiting full analysis...`
        }],
        contextId: payload.contextId
      };

      eventBus.publish(response);
    } catch (error) {
      console.error('❌ Error handling token discovery:', error);
    }
  }

  private async handleYieldReport(
    payload: A2AMessagePayload,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    try {
      const yieldData = payload.data as LiquidityData;
      const tokenAddress = yieldData.tokenAddress;

      const aggregatedData = this.aggregatedData.get(tokenAddress);
      if (aggregatedData) {
        aggregatedData.yield = yieldData;
        aggregatedData.lastUpdated = Date.now();
        this.aggregatedData.set(tokenAddress, aggregatedData);
        
        console.log(`💰 Updated yield data for ${aggregatedData.discovery.symbol}`);
      }
    } catch (error) {
      console.error('❌ Error handling yield report:', error);
    }
  }

  private async handleRiskReport(
    payload: A2AMessagePayload,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    try {
      const riskData = payload.data as RiskData;
      const tokenAddress = riskData.tokenAddress;

      const aggregatedData = this.aggregatedData.get(tokenAddress);
      if (aggregatedData) {
        aggregatedData.risk = riskData;
        aggregatedData.lastUpdated = Date.now();
        this.aggregatedData.set(tokenAddress, aggregatedData);
        
        console.log(`⚠️  Updated risk data for ${aggregatedData.discovery.symbol}`);
      }
    } catch (error) {
      console.error('❌ Error handling risk report:', error);
    }
  }

  private async handleAlertDecision(
    payload: A2AMessagePayload,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    try {
      const alertData = payload.data as AlertSignal;
      const tokenAddress = alertData.tokenAddress;

      // Ensure aggregated entry exists
      let aggregatedData = this.aggregatedData.get(tokenAddress);
      if (!aggregatedData) {
        // Create a minimal discovery object if missing
        aggregatedData = {
          discovery: {
            address: tokenAddress,
            symbol: alertData.symbol || tokenAddress,
            name: alertData.symbol || tokenAddress,
            dex: 'unknown',
            timestamp: Date.now()
          } as MemecoinData,
          yield: null,
          risk: null,
          alert: null,
          lastUpdated: Date.now()
        };
      }

      // Update aggregated with alert, and include yield/risk payloads if present
      aggregatedData.alert = alertData;
      // AlertSignal contains yieldData and riskData; copy them into aggregation so dashboard and LLM context see them
      if ((alertData as any).yieldData) {
        aggregatedData.yield = (alertData as any).yieldData as LiquidityData;
      }
      if ((alertData as any).riskData) {
        aggregatedData.risk = (alertData as any).riskData as RiskData;
      }

      aggregatedData.lastUpdated = Date.now();
      this.aggregatedData.set(tokenAddress, aggregatedData);

      console.log(`🚨 Updated alert/analysis for ${alertData.symbol}: ${alertData.alertType}`);
    } catch (error) {
      console.error('❌ Error handling alert decision:', error);
    }
  }

  private async handleSettlementUpdate(
    payload: A2AMessagePayload,
    eventBus: ExecutionEventBus
  ): Promise<void> {
    try {
      console.log('💵 Settlement update received');
      // Log settlement activity for dashboard
    } catch (error) {
      console.error('❌ Error handling settlement update:', error);
    }
  }

  // Get complete token analysis
  getTokenAnalysis(tokenAddress: string): AggregatedTokenData | null {
    return this.aggregatedData.get(tokenAddress) || null;
  }

  // Get all insights
  getAllInsights(): InsightReport[] {
    return this.insights;
  }

  // Get tracked tokens count
  getTrackedTokensCount(): number {
    return this.aggregatedData.size;
  }
}

// Start the agent if this file is run directly
if (require.main === module) {
  const agent = new PersonalAssistantAgent();
  
  agent.initialize().catch(error => {
    console.error('❌ Failed to start Personal Assistant Agent:', error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down Personal Assistant Agent...');
    await agent.shutdown();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\n🛑 Shutting down Personal Assistant Agent...');
    await agent.shutdown();
    process.exit(0);
  });
}
