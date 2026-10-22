// Direct exports from the desktop/backend contract; no Android-specific segmentation rules.
export {
  PRODUCT_SYNC_SCHEMA,
  PRODUCT_ENTITY_TYPES,
  productMessageId,
  productConversationId,
  legacyTaxonomyId,
  productRecord,
  validateProductRecord,
  productValue,
  prepareProductEntry,
  prepareProductPayload,
  hydrateProductPayload,
  productLibraryView,
} from '../../public/shared/sync-product.js';
