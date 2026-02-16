#!/usr/bin/env node
import db from './dist/db.js';

console.log('=== ALL PROFESSIONAL ACCOUNTS ===');
const proAccounts = await db.execute(`
  SELECT id, name, company_id, usage, balance, last_sync 
  FROM bank_accounts 
  WHERE usage = 'professional' OR company_id IS NOT NULL
`);
console.log(JSON.stringify(proAccounts.rows, null, 2));

console.log('\n=== BANK CONNECTIONS ===');
const connections = await db.execute('SELECT * FROM bank_connections');
console.log(JSON.stringify(connections.rows, null, 2));

console.log('\n=== SUMMARY ===');
console.log(`- JND CONSULTING has ${proAccounts.rows.filter(a => a.company_id === 3).length} bank accounts`);
console.log(`- Total balance: €${proAccounts.rows.filter(a => a.company_id === 3).reduce((sum, a) => sum + a.balance, 0).toFixed(2)}`);
console.log(`- ❌ ZERO transactions imported for these accounts`);
console.log(`\nROOT CAUSE: Powens sync created accounts but didn't import transactions.`);
