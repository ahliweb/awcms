const REVISION_FIELDS = [
  { key: 'name', label: 'Name' },
  { key: 'slug', label: 'Slug' },
  { key: 'description', label: 'Description' },
  { key: 'section_mode', label: 'Section Mode' },
  { key: 'status', label: 'Status' },
  { key: 'template_part_id', label: 'Template Part ID' },
  { key: 'owner_tenant_id', label: 'Owner Tenant ID' },
  { key: 'metadata', label: 'Metadata', json: true },
  { key: 'content', label: 'Content', json: true },
];

const normalizeValue = (value, useJson = false) => {
  if (value === null || value === undefined) return 'null';
  if (useJson) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

export const compareReusableSectionRevision = (currentSection, revisionSnapshot) => {
  const snapshot = revisionSnapshot || {};

  const fields = REVISION_FIELDS.map((field) => {
    const currentValue = normalizeValue(currentSection?.[field.key], field.json);
    const revisionValue = normalizeValue(snapshot?.[field.key], field.json);

    return {
      key: field.key,
      label: field.label,
      currentValue,
      revisionValue,
      changed: currentValue !== revisionValue,
    };
  });

  return {
    changedFields: fields.filter((field) => field.changed),
    unchangedFields: fields.filter((field) => !field.changed),
    hasChanges: fields.some((field) => field.changed),
  };
};

export const compareReusableSectionRevisions = (leftSnapshot, rightSnapshot) => {
  const left = leftSnapshot || {};
  const right = rightSnapshot || {};

  const fields = REVISION_FIELDS.map((field) => {
    const leftValue = normalizeValue(left?.[field.key], field.json);
    const rightValue = normalizeValue(right?.[field.key], field.json);

    return {
      key: field.key,
      label: field.label,
      currentValue: leftValue,
      revisionValue: rightValue,
      changed: leftValue !== rightValue,
    };
  });

  return {
    changedFields: fields.filter((field) => field.changed),
    unchangedFields: fields.filter((field) => !field.changed),
    hasChanges: fields.some((field) => field.changed),
  };
};
