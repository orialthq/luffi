# Domain contracts

`index.js` exports `domainRegistry`, `createDomainRegistry(packs)`, `DOMAIN_PACKS`,
and `DomainContractError`. The default registry contains recipe, dining, fashion,
and beauty packs. It has no HTTP, persistence, model, or external service dependency.

```js
import { domainRegistry } from "./domains/index.js";

const predicates = Object.fromEntries(
  domainRegistry.listRelations().map((spec) => [spec.id, spec]),
);
const spec = domainRegistry.getCapability("recipe.scale_servings");
domainRegistry.validateCapabilityInput(spec.id, input);
const output = domainRegistry.execute(spec.id, input);
domainRegistry.validateArtifact("recipe.scaled_recipe", output);
```

All `list*` methods return new arrays of immutable specifications. `getPack`,
`getType`, `getRelation`, `getCapability`, `getSlot`, `getArtifact`, and
`getRenderer` reject unknown IDs. Validation returns the original value or throws
an `AppError` subclass. `validate(typeId, value)` checks both schema and registered
type rules. `validateCapabilityInput/Output`, `validateSlot`, `validateArtifact`,
and `validateRelation` provide the corresponding entry points. Relations use
`single|many` and `resolution: { strategy, version }`, matching the knowledge
kernel. Capability `taskKind` uses the activity kernel vocabulary.

These checks validate shape and domain meaning, not ownership, existence of an
evidence ID, factual accuracy, current revision, or permission to perform an
action. The calling kernel must check those. A reservation confirmation requires
a reference and evidence IDs; their authenticity must be verified by the kernel
or the authorized adapter. Input/output identity agreement must also be checked
when applying user or model results to an existing task.

`execute` runs only repository-owned pure system rules. It clones inputs, checks
outputs, and returns a detached result. Declared capabilities without a pure rule
throw `DOMAIN_EXECUTION_UNAVAILABLE`; registering a capability does not implement
its model, user, or external execution adapter. No call changes a task, confirms
a purchase, or consumes inventory.

## Recipe rules

`recipe.scale_servings` accepts `{ recipe, targetServings }`. A recipe carries
`id`, `revision`, `title`, `baseServings`, and `ingredients`. Each requirement has
an independent `id`, an `ingredientId`, a `name`, a `quantity`, and a
`scaling: linear|fixed` rule. Quantities distinguish known amounts from `unknown`
and `as_needed`. Fixed quantities stay fixed; fractional counts are not rounded
to whole units. Numeric calculation uses twelve significant digits and rejects
overflow.

`recipe.calculate_requirements` adds `inventory` and optional
`includeOptionalIngredientIds` (requirement IDs). Inventory is the caller's
already-resolved, currently applicable observation per ingredient, not raw lots
or conflicting assertions. The context layer decides freshness and deducts
other resource claims before supplying available stock. Missing observations
stay unknown, whereas an explicit known zero means absent stock.

Repeated requirements for the same ingredient are aggregated before stock is
subtracted once. Only g/kg and ml/l conversions are inferred. Counts and spoon
units retain their own dimensions. Density, package sizes, spoon conventions,
substitutions, and inventory consumption are not guessed. Optional requirements
are included only when explicitly selected. A previous purchase is represented
by a new applicable inventory observation; the calculation does not edit its
completed purchase task.

## Extending a pack

Packs declare versioned types, entity types, relations, slots, capabilities, and
artifacts. A registry validates references and task contracts at construction.
The schema vocabulary is the repository-owned subset used in `schema.js`;
this module is not a general-purpose JSON Schema implementation. Domain rules
and type validators live in the pack, so registry dispatch never branches on
`recipe`, `dining`, `fashion`, or `beauty`.
