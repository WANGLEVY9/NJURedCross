export const dateLines = value => String(value ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
