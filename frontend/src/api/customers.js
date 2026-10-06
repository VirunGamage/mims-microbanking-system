// The calls behind the Customers and Open Account pages (and the account look-ups other pages reuse). Owner: Sameera.
// Uses GET/POST /api/customers and GET/POST /api/accounts. Reads return paths for useApiData; actions return promises.
// API helper functions for fetching, searching, and registering customers and accounts.
import { api } from './client.js';

// The server sends at most this many customers for one search (backend/src/routes/customers.js), so 50 means "50 or more".
export const CUSTOMER_SEARCH_LIMIT = 50;

export const customersPath = (search = '') => `/customers?search=${encodeURIComponent(search)}`;
export const customerPath = (customerId) => `/customers/${encodeURIComponent(customerId)}`;
export const accountSearchPath = (search = '') => `/accounts?search=${encodeURIComponent(search)}`;
export const accountPath = (accountId) => `/accounts/${encodeURIComponent(accountId)}`;

// { firstName, lastName, dob, nic, phone, email, address, agentId } -> the new customer, with their (empty) account list
export function registerCustomer(form) {
  return api.post('/customers', form);
}

// { primaryCustomerId, secondaryCustomerId, openingAmount, agentId } -> the new account, its plan, holders and reference
export function openAccount(form) {
  return api.post('/accounts', form);
}

export function searchCustomers(search) {
  return api.get(customersPath(search));
}

export function getCustomer(customerId) {
  return api.get(customerPath(customerId));
}

export function getAccount(accountId) {
  return api.get(accountPath(accountId));
}

export function searchAccounts(search) {
  return api.get(accountSearchPath(search));
}
