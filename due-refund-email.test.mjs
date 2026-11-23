import {test} from 'node:test';
import assert from 'node:assert/strict';
import {refundEmail} from './supabase/functions/due-refund-mail/template.mjs';
const base={orderId:'26-15401-29635',store:'Example Store',title:'Product <script>',image:'https://i.ebayimg.com/images/example.jpg',reason:'outbound_delivered',eventDate:'2026-11-23T12:00:00Z',dateLabel:'eBay Delivered Date'};
test('outbound reminder identifies order, date, image and required refund work',()=>{const m=refundEmail(base);assert.match(m.subject,/26-15401-29635/);assert.match(m.htmlContent,/Due Refund/);assert.match(m.htmlContent,/width="112"/);assert.match(m.htmlContent,/Nov 23, 2026/);assert.match(m.textContent,/remains marked Due Refund/);assert.match(m.textContent,/remaining refund tasks/);});
test('return reminder does not claim buyer delivery or invent a receipt timestamp',()=>{const m=refundEmail({...base,reason:'return_received',dateLabel:'Return Receipt Detected'});assert.match(m.textContent,/return has been recorded as received/);assert.match(m.textContent,/Return Receipt Detected/);assert.doesNotMatch(m.textContent,/eBay now reports delivery/);});
test('untrusted product strings and unsafe image URLs cannot inject email markup',()=>{const m=refundEmail({...base,image:'javascript:alert(1)'});assert.match(m.htmlContent,/Product &lt;script&gt;/);assert.doesNotMatch(m.htmlContent,/<script>|javascript:|<img/);});
test('missing dates are explicitly unknown',()=>{assert.match(refundEmail({...base,eventDate:'invalid'}).textContent,/Not provided by eBay/);});
