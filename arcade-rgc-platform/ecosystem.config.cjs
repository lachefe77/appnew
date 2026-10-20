module.exports = {
  apps: [
    {
      name: 'arena-arcade',
      script: 'server/index.js',
      node_args: '--experimental-vm-modules',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_development: {
        NODE_ENV: 'development',
        PORT: 3000,
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      time: true,
      // Graceful shutdown — espera até 10s para partidas ativas
      kill_timeout: 10000,
      shutdown_with_message: true,
      listen_timeout: 5000,
    }
  ]
};
