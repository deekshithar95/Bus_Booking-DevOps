CREATE DATABASE IF NOT EXISTS busbooking;
USE busbooking;

-- Minimal database initialization for the DevOps environment.
-- Add or migrate application tables through your normal application migration process.
CREATE TABLE IF NOT EXISTS devops_healthcheck (
  id INT AUTO_INCREMENT PRIMARY KEY,
  status VARCHAR(32) NOT NULL DEFAULT 'ready',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
