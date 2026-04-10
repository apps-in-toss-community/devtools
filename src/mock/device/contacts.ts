/**
 * Contacts mock
 */

import { aitState } from '../state.js';
import { withPermission, checkPermission } from '../permissions.js';

const _fetchContacts = async (options: { size: number; offset: number; query?: { contains?: string } }) => {
  checkPermission('contacts', 'fetchContacts');
  let contacts = aitState.state.contacts;
  if (options.query?.contains) {
    const q = options.query.contains.toLowerCase();
    contacts = contacts.filter(c => c.name.toLowerCase().includes(q) || c.phoneNumber.includes(q));
  }
  const sliced = contacts.slice(options.offset, options.offset + options.size);
  const nextOffset = options.offset + options.size;
  return {
    result: sliced,
    nextOffset: nextOffset < contacts.length ? nextOffset : null,
    done: nextOffset >= contacts.length,
  };
};
export const fetchContacts = withPermission(_fetchContacts, 'contacts');
