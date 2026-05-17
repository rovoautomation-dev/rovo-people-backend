#!/bin/bash
SERVER_URL="http://localhost:5005/iclock/cdata?SN=TESTSN123"
echo "Simulating ZKTeco Handshake to $SERVER_URL"
curl -v -X GET "$SERVER_URL" \
     -H "User-Agent: iClock Proxy/1.0" \
     -H "Accept: */*"
