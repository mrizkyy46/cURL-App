export default {
  rules: {
    'at-rule-no-unknown': [true, { ignoreAtRules: ['theme', 'source', 'utility', 'custom-variant', 'apply'] }],
    'block-no-empty': true,
    'color-no-invalid-hex': true,
    'declaration-block-no-duplicate-properties': true,
    'property-no-unknown': true,
    'no-invalid-double-slash-comments': true,
    'string-no-newline': true,
  },
};
