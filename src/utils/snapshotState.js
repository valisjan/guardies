// Separate data changes from cache/server confirmations. Counts are estimates,
// not billing: rules, query minimums and SDK reconnects are not visible here.
export function createSnapshotState() {
  let signature;
  let serverSeen = false;
  return (snapshot) => {
    const next = JSON.stringify(snapshot.exists() ? snapshot.data() : null);
    const contentChanged = signature !== next;
    signature = next;
    const { fromCache = false, hasPendingWrites = false } = snapshot.metadata || {};
    const confirmed = !fromCache && !hasPendingWrites;
    const reads = hasPendingWrites ? 0 : Number(contentChanged || (confirmed && !serverSeen));
    if (confirmed) serverSeen = true;
    return { fromCache, hasPendingWrites, metadataOnly: !contentChanged, reads };
  };
}
