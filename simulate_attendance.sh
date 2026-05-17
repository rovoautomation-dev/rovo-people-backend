#!/bin/bash
SERVER_URL="http://localhost:5005/iclock/cdata?SN=TESTSN123"
echo "Simulating ZKTeco Attendance POST to $SERVER_URL"
# Format: [EmployeeID] [YYYY-MM-DD] [HH:mm:ss] [Status] [VerifyType]
# Using Space as delimiter which is common in newer ADMS
BODY="101 2026-03-17 16:30:00 0 1
102 2026-03-17 16:35:00 0 1"

curl -v -X POST "$SERVER_URL" \
     -H "User-Agent: iClock Proxy/1.0" \
     -H "Content-Type: text/plain" \
     --data "$BODY"
