export const createServers = (origin = 'https://edge.example.com') => ([
  {
    url: origin.replace(/\/$/, ''),
    description: 'Current awcms-edge deployment origin',
  },
])
