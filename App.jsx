import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ExternalLink,
  BarChart2,
  Newspaper,
  Info,
  CheckCircle,
  AlertTriangle,
  Server,
  ShieldCheck,
  Clock,
  Target,
  Sparkles,
  Bot
} from 'lucide-react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer
} from 'recharts';

const API_BASE_URL = 'https://k-stock-ai.onrender.com/api';

const POPULAR_STOCKS = [
  { name: '삼성전자', code: '005930' },
  { name: 'SK하이닉스', code: '000660' },
  { name: 'LG에너지솔루션', code: '373220' },
  { name: 'NAVER', code: '035420' },
  { name: '현대차', code: '005380' },
  { name: '카카오', code: '035720' },
  { name: '셀트리온', code: '068270' }
];
