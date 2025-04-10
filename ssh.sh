#!/bin/bash

NODE_ENV=$1

COMMAND=$2

if [ -z "$NODE_ENV" ]; then
    echo "Usage: $0 <node_env> <command>"
    exit 1
fi

# Get the instance ID of the bastion host
INSTANCE_ID=$(aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=${NODE_ENV}-ec2-bastion-host" "Name=instance-state-name,Values=running" \
    --query "Reservations[0].Instances[0].InstanceId" \
    --output text)

if [ -z "$INSTANCE_ID" ]; then
    echo "No running bastion host instance found"
    exit 1
fi

# Get the public DNS of the instance
PUBLIC_DNS=$(aws ec2 describe-instances \
    --instance-ids $INSTANCE_ID \
    --query "Reservations[0].Instances[0].PublicDnsName" \
    --output text)

if [ -z "$PUBLIC_DNS" ]; then
    echo "Could not get public DNS for instance"
    exit 1
fi

# SSH to the instance
if [ -z "$COMMAND" ]; then
    ssh -i ~/.ssh/ec2-bastion-staging -o StrictHostKeyChecking=no ec2-user@$PUBLIC_DNS
else
    set -o pipefail
    ssh -i ~/.ssh/ec2-bastion-staging -o StrictHostKeyChecking=no ec2-user@$PUBLIC_DNS "$COMMAND"
    exit $?
fi