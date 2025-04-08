# Migration Notification Script

A simple Node.js script that fetches a secret from AWS Secrets Manager and sends a notification to a Slack channel when a migration is complete.

## Prerequisites

- Node.js 14 or higher
- AWS credentials configured
- Access to AWS Secrets Manager
- A Slack API token stored in AWS Secrets Manager

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Configure environment variables:
   ```
   export AWS_REGION="us-east-1"
   export SECRET_NAME="your-secret-name"
   export SLACK_CHANNEL="#your-channel"
   ```

## Running the Script

```
npm start
```

## Secret Format

The script expects the secret in AWS Secrets Manager to be a JSON object with a `SLACK_KEY` property:

```json
{
  "SLACK_KEY": "xoxb-your-slack-token"
}
```

## Authentication

The script uses the default AWS authentication. Make sure you have authenticated using one of the following methods:

- Configure AWS credentials using the AWS CLI: `aws configure`
- Set environment variables: `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`
- Use an EC2 instance role or ECS task role when running on AWS services 