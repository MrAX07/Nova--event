// PM2 – holder botten kørende 24/7 på en server (VPS): pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'nova-events',
      script: 'dist/index.js',
      instances: 1, // kør kun ÉN instans (botten må ikke dobbeltstartes)
      autorestart: true,
      max_memory_restart: '600M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
