#!/bin/bash

# Load environment variables from .env
if [ -f .env ]; then
    while IFS='=' read -r key value; do
        if [ -n "$key" ] && [ -n "$value" ]; then
            # Remove any quotes from the value
            value=$(echo "$value" | tr -d '"' | tr -d "'")
            export "$key=$value"
        fi
    done < .env
else
    echo ".env file not found"
    exit 1
fi

# Check for --rotate-pwd flag
if [[ "$*" == *"--rotate-pwd"* ]]; then
    pulumi config set rotatePassword true
else
    pulumi config set rotatePassword false
fi

# Run pulumi up on index-staging.ts
pulumi up --stack staging