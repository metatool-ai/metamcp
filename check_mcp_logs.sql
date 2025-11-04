-- Check if mcp_request_logs table exists
SELECT EXISTS (
   SELECT FROM information_schema.tables
   WHERE  table_schema = 'public'
   AND    table_name   = 'mcp_request_logs'
);

-- Count total mcp_request_logs
SELECT COUNT(*) as total_logs FROM mcp_request_logs;

-- Show recent mcp_request_logs with their client_id
SELECT
  uuid,
  client_id,
  user_id,
  session_id,
  endpoint_name,
  request_type,
  tool_name,
  response_status,
  created_at
FROM mcp_request_logs
ORDER BY created_at DESC
LIMIT 20;

-- Group by client_id to see which clients have logs
SELECT
  client_id,
  COUNT(*) as log_count,
  MAX(created_at) as last_log
FROM mcp_request_logs
GROUP BY client_id
ORDER BY log_count DESC;
