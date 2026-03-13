export const TEAMS = [
  'ML Platform', 'Risk Engine', 'Growth',
  'Search', 'Recommendations', 'NLP Core',
]

export const MODEL_TYPES = [
  'classification', 'regression', 'ranking', 'clustering', 'llm',
]

export const SEVERITIES = ['INFO', 'WARNING', 'CRITICAL']

export const STATUSES = ['healthy', 'warning', 'critical', 'inactive']

export const ENGINES = ['local', 'spark', 'dask', 'ray', 'sql']

export const SOURCE_TYPES = [
  { value: 's3',            label: 'AWS S3' },
  { value: 'gcs',           label: 'Google Cloud Storage' },
  { value: 'sql',           label: 'SQL Database' },
  { value: 'unity_catalog', label: 'Unity Catalog' },
  { value: 'upload',        label: 'Direct Upload (CSV)' },
]

export const FEATURES_POOL = [
  'age', 'income', 'credit_score', 'tenure_months', 'num_products',
  'balance', 'is_active', 'num_transactions', 'avg_transaction_amt',
  'days_since_last_login', 'support_tickets', 'region', 'channel',
  'device_type', 'signup_source', 'email_domain', 'payment_method',
  'subscription_tier', 'lifetime_value', 'churn_risk_30d',
]

export const MODEL_NAMES = [
  'Churn Predictor', 'Fraud Detector', 'LTV Estimator', 'Recommendation Engine',
  'Search Ranker', 'Sentiment Analyzer', 'Credit Scorer', 'Demand Forecaster',
  'Anomaly Detector', 'Lead Scorer', 'Price Optimizer', 'Content Classifier',
]

export const OWNERS = [
  'alice.chen', 'bob.kumar', 'carol.silva', 'dan.okonkwo', 'eve.tanaka',
]
