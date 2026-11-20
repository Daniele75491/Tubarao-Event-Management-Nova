// Attendance and revenue from server-authorized PAID reservation data.
(function(root) {
  const category = record => String(record.cat ?? record.category ?? '').trim().toLowerCase();
  const cents = value => Math.round((value + Number.EPSILON) * 100);
  const percentage = (count, total) => total === 0 ? '0%' : (count / total * 100).toFixed(1) + '%';
  function calculate(tickets, nonPaying) {
    const paid = tickets.filter(t => t && Number.isFinite(t.price) && t.price >= 0 && t.valid !== false && t.paid !== false && t.status === 'PAID');
    const paidMen = paid.filter(t => category(t) === 'men').length;
    const paidWomen = paid.filter(t => category(t) === 'women').length;
    const nonPayingMen = nonPaying.filter(t => category(t) === 'men').length;
    const nonPayingWomen = nonPaying.filter(t => category(t) === 'women').length;
    const total = paid.length + nonPaying.length;
    const revenue = paid.reduce((sum, ticket) => sum + cents(ticket.price), 0) / 100;
    return {
      paid:paid.length, nonPaying:nonPaying.length, total,
      paidMen, paidWomen, totalMen:paidMen + nonPayingMen, totalWomen:paidWomen + nonPayingWomen,
      paidMenPercent:percentage(paidMen,paid.length), paidWomenPercent:percentage(paidWomen,paid.length),
      totalMenPercent:percentage(paidMen+nonPayingMen,total), totalWomenPercent:percentage(paidWomen+nonPayingWomen,total),
      uncategorizedNonPaying:nonPaying.length-nonPayingMen-nonPayingWomen,
      uncategorizedPaid:paid.length-paidMen-paidWomen, revenue
    };
  }
  function render(document, tickets, nonPaying, formatMoney) {
    const kpi = calculate(tickets,nonPaying);
    const values = {
      'm-total':kpi.paid, 'm-non-paying':kpi.nonPaying, 'm-attendees':kpi.total,
      'm-paid-men':kpi.paidMen, 'm-paid-women':kpi.paidWomen, 'm-total-men':kpi.totalMen, 'm-total-women':kpi.totalWomen,
      'm-paid-men-percent':kpi.paidMenPercent + ' of paid attendees', 'm-paid-women-percent':kpi.paidWomenPercent + ' of paid attendees',
      'm-total-men-percent':kpi.totalMenPercent + ' of total attendees', 'm-total-women-percent':kpi.totalWomenPercent + ' of total attendees',
      'm-revenue':formatMoney(kpi.revenue)
    };
    Object.entries(values).forEach(([id,value]) => { document.getElementById(id).textContent = value; });
    const categoryNote = document.getElementById('kpi-category-note');
    categoryNote.textContent = kpi.uncategorizedNonPaying + ' non-paying and ' + kpi.uncategorizedPaid + ' paid attendees have no recorded Men/Women category. Total counts include them; gender percentages may not sum to 100%.';
    categoryNote.hidden = !(kpi.uncategorizedNonPaying || kpi.uncategorizedPaid);
  }
  const api = {calculate,render};
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TubaraoKPIs = api;
})(typeof window === 'undefined' ? globalThis : window);
