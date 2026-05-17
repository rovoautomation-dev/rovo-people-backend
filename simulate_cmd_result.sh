#!/bin/bash
SERVER_URL="http://localhost:5005/iclock/devicecmd?SN=TESTSN123"
echo "Simulating ZKTeco Command Result POST to $SERVER_URL"
# Format: ID=xxx&Return=0&CMD=CREATEUSER
BODY="ID=12345&Return=0&CMD=LOG"

curl -v -X POST "$SERVER_URL" \
     -H "User-Agent: iClock Proxy/1.0" \
     -H "Content-Type: text/plain" \
     --data "$BODY"
