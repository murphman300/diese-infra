🏗️ Diese Infra

A Pulumi (TypeScript) infrastructure project for managing a fully secured AWS environment — including VPC, ECS, and RDS — with built-in GitHub Actions integration for smooth, secure deployments.

🚀 Overview

This repo provisions and manages:

Secure VPC Architecture — Network isolation for ECS services and RDS instances.

Automated Deployments — GitHub Actions-based permissions to trigger updates without polling or manual registry syncs.

Bastion Host Access — Enables database migrations or maintenance tasks to run through GitHub Actions securely via a bastion-routed connection (no need for standalone ephemeral instances).

Password Rotation & Secrets Management — Automatically rotates database credentials and updates AWS KMS secrets, granting least-privilege access to required resource groups.

Multi-Environment Support — Easily extend or deploy across multiple environments (e.g., dev, staging, prod).

🔐 Security Highlights

DMZ-style bastion setup for controlled internal database access

Enforced least-privilege IAM roles

KMS-backed secret rotation and propagation

No external polling or long-lived tokens

🧩 Tech Stack

Pulumi (TypeScript)

AWS ECS + RDS + KMS

GitHub Actions for CI/CD and secure migration routing
