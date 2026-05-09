module.exports = {
    apps: [
        // Bot
        {
            name: 'Craig',
            script: './apps/bot/dist/sharding/index.js',
            wait_ready: true,
            kill_timeout: 3000,
            env: { NODE_ENV: 'development' },
            env_production: { NODE_ENV: 'production' }
        },
        // Dashboard
        {
            name: 'Craig Dashboard',
            script: 'npm',
            args: 'start',
            cwd: './apps/dashboard',
            env: { NODE_ENV: 'development' },
            env_production: { NODE_ENV: 'production' }
        },
        // Download (clustered)
        {
            name: 'craig.horse',
            script: './apps/download/dist/index.js',
            instances: 8,
            exec_mode: 'cluster',
            wait_ready: true,
            listen_timeout: 10000,
            kill_timeout: 3000,
            env: { NODE_ENV: 'development' },
            env_production: { NODE_ENV: 'production' }
        },
        // Tasks
        {
            name: 'Craig Tasks',
            script: './apps/tasks/dist/index.js',
            wait_ready: true,
            kill_timeout: 3000,
            env: { NODE_ENV: 'development' },
            env_production: { NODE_ENV: 'production' }
        }
    ]
};
