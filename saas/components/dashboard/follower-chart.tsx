'use client'

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { formatNumber } from '@/lib/utils'

interface FollowerChartProps {
  data: { recorded_at: string; followers_count: number }[]
}

export function FollowerChart({ data }: FollowerChartProps) {
  const chartData = data.map(s => ({
    date: new Date(s.recorded_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    followers: s.followers_count,
  }))

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tickFormatter={v => formatNumber(v)}
          tick={{ fontSize: 11, fill: '#9ca3af' }}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <Tooltip
          formatter={(value) => [formatNumber(Number(value)), 'Followers']}
          contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb', fontSize: 12 }}
          labelStyle={{ color: '#374151', fontWeight: 600 }}
        />
        <Line
          type="monotone"
          dataKey="followers"
          stroke="url(#gradient)"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: '#7c3aed' }}
        />
        <defs>
          <linearGradient id="gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="100%" stopColor="#db2777" />
          </linearGradient>
        </defs>
      </LineChart>
    </ResponsiveContainer>
  )
}
