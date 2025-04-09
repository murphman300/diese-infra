// (e.g., via environment variables, IAM role, etc.)'
const { Pool } = require('pg');
const { SecretsManagerClient, GetSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const region = process.env.AWS_REGION || "ca-central-1";
// 
// ault to us-east-1 if not set
const secretName = "staging/diesedb/credentials-1";

const secretsClient = new SecretsManagerClient({ region });

async function getDatabaseUrlFromSecretsManager() {
    console.log(`Fetching secret ${secretName} from AWS Secrets Manager...`);
    try {
        const command = new GetSecretValueCommand({ SecretId: secretName });
        const data = await secretsClient.send(command);

        if ('SecretString' in data) {
            const secret = JSON.parse(data.SecretString);
            // --- IMPORTANT --- 
            // Adjust the key ('DATABASE_URL') if your secret uses a different name
            // Check that all required variables exist
            const requiredVars = ['DB_USERNAME', 'DB_PASSWORD', 'DB_HOST', 'DB_NAME', 'DB_PORT'];
            for (const v of requiredVars) {
                if (!secret[v]) {
                    console.error(`Error: Required key '${v}' not found in secret ${secretName}.`);
                    process.exit(1);
                }
            }
            console.log('Successfully retrieved database URL from secret.');
            return {
                user: secret.DB_USERNAME,
                host: secret.DB_HOST.split(':')[0],
                database: secret.DB_NAME,
                password: secret.DB_PASSWORD,
                port: secret.DB_PORT,
                ssl: {
                  // For a self-signed certificate or when you don't want to validate the server's certificate chain:
                  rejectUnauthorized: false
                }
              };
        } else {
            // Handle binary secrets if needed, though connection strings are usually strings
            console.error(`Secret ${secretName} does not contain a SecretString.`);
            process.exit(1);
        } 
    } catch (error) {
        console.error(`Failed to retrieve secret ${secretName}:`, error);
        process.exit(1);
    }
}

async function testDatabaseConnection() {

    const connectionInfo = await getDatabaseUrlFromSecretsManager();

    if (!connectionInfo) {
        // Error handling is done within getDatabaseUrlFromSecretsManager
        return; 
    }

    console.log('Attempting to connect to the database using retrieved credentials...');

    const pool = new Pool(connectionInfo);

    console.log(connectionInfo);

    try {
        const client = await pool.connect();
        console.log('Successfully connected to the database.');
        
        await client.query('SELECT 1');
        console.log('Successfully executed a test query (SELECT 1).');
        
        client.release();
        console.log('Database connection test successful.');
        process.exit(0);
    } catch (error) {
        console.error('Failed to connect to the database:', error);
        process.exit(1);
    } finally {
        await pool.end();
        console.log('Database pool closed.');
    }
}

testDatabaseConnection();