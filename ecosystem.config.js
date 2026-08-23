module.exports = {
  apps: [
    {
      name: 'lawson',
      script: 'node_modules/.bin/next',
      args: 'start -p 29696',
      cwd: '/home/krazyeom/dev/kakaojapan',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      merge_logs: true,
    },
  ],
};
