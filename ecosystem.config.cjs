const BUN_PATH = "/root/.bun/bin/bun";

module.exports = {
  apps: [
    {
      name: "sta-demo-3",
      script: `${BUN_PATH} run src/server/index.ts`,
      env: {
        NODE_ENV: "production",
        AWS_REGION: "us-west-1",
      },
    },
  ],
};
