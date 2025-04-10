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

## Using the SSH Admin Script

The `ssh-admin.sh` script allows you to connect to the bastion host via SSH with port forwarding for secure access to prisma studio running on it.

On ssh login, the studio instance will spin up, and will spin down on ssh logout.

### Prerequisites

- AWS CLI installed and configured
- SSH key at `~/.ssh/ec2-bastion-staging` for authentication
- Proper IAM permissions to describe EC2 instances

### Usage

```bash
./ssh-admin.sh <environment>
```

Where `<environment>` is the environment name (e.g., staging, production).

#### Example

```bash
./ssh-admin.sh staging
```

This will:

1. Find the bastion host EC2 instance for the specified environment
2. Establish an SSH connection with port forwarding for port 3333
3. Connect you to the bastion host as the ec2-user

### Port Forwarding

The script sets up port forwarding from your local port 3333 to the bastion host's port 3333. This can be used to access services running on the bastion host or for further tunneling to other services in the private network.
