/**
 * PM2 Ecosystem Configuration
 *
 * For AWS SSO to work with PM2, you have two options:
 *
 * OPTION 1: Use temporary STS credentials (recommended for demos)
 * Run: aws configure export-credentials --profile <your-sso-profile>
 * Then fill in AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and AWS_SESSION_TOKEN below.
 *
 * OPTION 2: Use SSO login (requires re-login every 8-12 hours)
 * 1. Login as the PM2 user: aws sso login --profile <your-sso-profile>
 * 2. Verify: aws sts get-caller-identity --profile <your-sso-profile>
 * 3. Set AWS_SSO_PROFILE below
 *
 * ⚠️  SSO tokens expire! For a demo that "never breaks", use OPTION 1.
 */

// Update this path if bun is installed elsewhere on the server
const BUN_PATH = "/root/.bun/bin/bun";

module.exports = {
  apps: [
    {
      name: "sta-demo-3",
      script: `${BUN_PATH} run src/server/index.ts`,
      env: {
        NODE_ENV: "production",
        AWS_REGION: "us-west-1",

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // OPTION 1: Static credentials (recommended for reliable demos)
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // Get these by running: aws configure export-credentials --profile <your-sso-profile>
        // These will also expire but last longer and don't require SSO login on server
        //
        AWS_ACCESS_KEY_ID: "ASIAXXX",
        AWS_SECRET_ACCESS_KEY: "xxx",
        AWS_SESSION_TOKEN: "xxx",

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // OPTION 2: SSO profile (requires aws sso login on server)
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // AWS_SSO_PROFILE: "298697287015_PowerUserAccess",

        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // S3 Bucket configuration
        // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
        // AWS_BUCKET_NAME: "your-bucket-name",
      },
    },
  ],
};
