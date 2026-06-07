module.exports = {
    apps: [
        // Bot — tsx watch transpiles src/sharding/index.ts on the fly
        {
            name: 'Craig',
            script: '/app/node_modules/.bin/tsx',
            args: 'watch src/sharding/index.ts',
            cwd: '/app/apps/bot',
            kill_timeout: 3000,
            env: { NODE_ENV: 'development' }
        },
        // Dashboard — Next.js dev server with built-in HMR
        {
            name: 'Craig Dashboard',
            script: 'npm',
            args: 'run dev',
            cwd: '/app/apps/dashboard',
            env: { NODE_ENV: 'development' }
        },
        // Download API — tsx watch transpiles api/src/index.ts on the fly
        {
            name: 'craig.horse API',
            script: '/app/node_modules/.bin/tsx',
            args: 'watch src/index.ts',
            cwd: '/app/apps/download/api',
            kill_timeout: 3000,
            env: { NODE_ENV: 'development' }
        },
        // Download page — rollup in watch mode rebuilds on source change
        {
            name: 'craig.horse Page',
            script: '/app/node_modules/.bin/rollup',
            args: '-c --watch',
            cwd: '/app/apps/download',
            env: { NODE_ENV: 'development' }
        },
        // Tasks — tsx watch transpiles src/index.ts on the fly
        {
            name: 'Craig Tasks',
            script: '/app/node_modules/.bin/tsx',
            args: 'watch src/index.ts',
            cwd: '/app/apps/tasks',
            kill_timeout: 3000,
            env: { NODE_ENV: 'development' }
        }
    ]
};
