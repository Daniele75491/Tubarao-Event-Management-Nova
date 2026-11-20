// Read-only list presentation. This module never changes check-in state.
(function(root) {
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en').trim();
  const status = ticket => ticket.checkedIn === true ? 'Checked in' : 'Paid / Not checked in';
  function select(records, options = {}) {
    const rows = records.filter(ticket =>
      normalize(ticket.first).includes(normalize(options.first)) &&
      normalize(ticket.last).includes(normalize(options.last)) &&
      normalize(ticket.email).includes(normalize(options.email)) &&
      (!options.category || ticket.cat === options.category) &&
      (!options.status || (ticket.checkedIn === true ? 'checked' : 'paid') === options.status));
    const field = options.sort === 'last' ? 'last' : options.sort === 'category' ? 'cat' : 'first';
    const compare = (a,b) => normalize(a).localeCompare(normalize(b), 'en', {numeric:true});
    const primary = (a,b) => {
      if (options.sort === 'checked') return Number(b.checkedIn === true)-Number(a.checkedIn === true);
      if (['not-checked','status'].includes(options.sort)) return Number(a.checkedIn === true)-Number(b.checkedIn === true);
      if (options.sort === 'women') return Number(b.cat === 'women')-Number(a.cat === 'women');
      if (options.sort === 'men') return Number(b.cat === 'men')-Number(a.cat === 'men');
      return compare(a[field],b[field]);
    };
    return rows.sort((a,b) => primary(a,b) || compare(a.last,b.last) || compare(a.first,b.first) || compare(a.id || a.code,b.id || b.code));
  }
  const api = {select,status};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TubaraoAttendees = api;
})(typeof window === 'undefined' ? globalThis : window);
