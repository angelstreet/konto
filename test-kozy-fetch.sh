#!/bin/bash
echo "Testing Konto → Kozy integration..."
echo ""
curl -s http://127.0.0.1:5004/api/kozy/properties \
  -H "Authorization: Bearer 87ca2196f8347646d0ee770b91749060fd56197959c765f7240c457897f8d727" | \
  jq -r 'if .properties then 
    (.properties | length as $count | 
    "✅ Konto successfully fetched \($count) properties from Kozy:", 
    "", 
    (.[] | "  📍 \(.name)", "     - \(.bookings_count) bookings", "     - \(.occupancy.current_month.rate_percent)% occupancy", ""))
  else 
    "❌ Error: " + (. | tostring)
  end'
