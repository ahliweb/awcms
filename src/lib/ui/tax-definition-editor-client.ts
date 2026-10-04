/**
 * The structured tax-definition editor (Issue #901) — progressive enhancement
 * over the JSON textarea on `/admin/tax`.
 *
 * ## The textarea stays the source of truth
 *
 * The form submits `#draft-definition`, exactly as before. With JavaScript off
 * the page is the old one: a JSON textarea inside an open `<details>`. With it
 * on, this module reveals a row-based editor and collapses the textarea into an
 * "advanced" disclosure; every edit re-serialises into the textarea, and an edit
 * in the textarea (when it parses into something the editor can show faithfully)
 * reloads the rows. The server validates the result and remains authoritative —
 * nothing here duplicates its rules.
 *
 * ## DOM, not markup strings
 *
 * Everything is built with `createElement` + `textContent`/`value`, never
 * `innerHTML`, and nothing sets a `style` attribute (the app's CSP). The labels
 * arrive translated from the server in `data-labels`.
 *
 * ## Accessibility
 *
 * Every control has a visible `<label>`; groups are `<fieldset>`/`<legend>`;
 * add/remove are real `<button type="button">`s whose accessible name says WHAT
 * they add or remove ("Remove category 2"). After an add, focus moves to the new
 * row's first field; after a remove, to the section's add button.
 */
import {
  EDITOR_MAX_COMPONENTS_PER_RULE,
  emptyComponent,
  emptyRule,
  initialModel,
  loadEditableModel,
  serializeModel,
  type EditorModel
} from "./tax-definition-model";

type Labels = {
  categories: string;
  category: string;
  rules: string;
  rule: string;
  components: string;
  component: string;
  code: string;
  name: string;
  description: string;
  appliesTo: string;
  fallbackCategory: string;
  undeclaredCategory: string;
  treatment: string;
  rate: string;
  rateHint: string;
  basis: string;
  addCategory: string;
  addRule: string;
  addComponent: string;
  remove: string;
  treatments: Record<string, string>;
  bases: Record<string, string>;
  notShown: string;
  resetEditor: string;
  noComponents: string;
};

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) {
    node.append(child);
  }
  return node;
}

export function initTaxDefinitionEditor(): void {
  const mountElement = document.getElementById("tax-definition-editor");
  const textareaElement = document.getElementById("draft-definition");
  const advancedElement = document.getElementById("tax-definition-advanced");

  if (
    !mountElement ||
    !(textareaElement instanceof HTMLTextAreaElement) ||
    !(advancedElement instanceof HTMLDetailsElement)
  ) {
    return;
  }

  // Narrowed once, so the closures below keep the narrow types.
  const mount: HTMLElement = mountElement;
  const textarea: HTMLTextAreaElement = textareaElement;
  const advanced: HTMLDetailsElement = advancedElement;

  let labels: Labels;
  try {
    labels = JSON.parse(mount.dataset.labels ?? "") as Labels;
  } catch {
    return; // No labels, no editor: the textarea keeps working.
  }

  const treatmentValues = Object.keys(labels.treatments);
  const basisValues = Object.keys(labels.bases);
  // `editable` is false while the textarea holds JSON the rows cannot show:
  // the rows are then hidden and never written back (sync() would clobber it).
  const initial = loadEditableModel(textarea.value);
  let model: EditorModel = initial ?? initialModel();
  let editable = initial !== null;

  const notice = el("p", {
    className: "page-description",
    hidden: true,
    textContent: labels.notShown
  });
  notice.setAttribute("role", "status");
  const body = el("div", { className: "tax-editor-body" });
  const resetButton = el("button", {
    type: "button",
    className: "btn-inline",
    textContent: labels.resetEditor,
    hidden: true
  });
  resetButton.dataset.editorAction = "reset";
  mount.append(notice, resetButton, body);

  function setEditable(next: boolean): void {
    editable = next;
    body.hidden = !next;
    resetButton.hidden = next;
    notice.hidden = next;
  }

  function sync(): void {
    if (!editable) return;
    textarea.value = serializeModel(model);
    notice.hidden = true;
  }

  function field(
    labelText: string,
    control: HTMLInputElement | HTMLSelectElement
  ): HTMLLabelElement {
    return el("label", {}, labelText, control);
  }

  function textInput(
    value: string,
    onInput: (value: string) => void,
    key: string,
    options: { max?: number; decimal?: boolean; placeholder?: string } = {}
  ): HTMLInputElement {
    const input = el("input", { type: "text", value });
    input.dataset.editorField = key;
    input.autocomplete = "off";
    if (options.max) input.maxLength = options.max;
    if (options.decimal) input.inputMode = "decimal";
    if (options.placeholder) input.placeholder = options.placeholder;
    input.addEventListener("input", () => {
      onInput(input.value);
      sync();
      refreshCategoryOptions();
    });
    return input;
  }

  function select(
    values: readonly [string, string][],
    current: string,
    onChange: (value: string) => void
  ): HTMLSelectElement {
    const control = el("select");
    for (const [value, text] of values) {
      const option = el("option", { value, textContent: text });
      option.selected = value === current;
      control.append(option);
    }
    control.addEventListener("change", () => {
      onChange(control.value);
      sync();
    });
    return control;
  }

  function button(
    text: string,
    accessibleName: string,
    onClick: () => void,
    className = "btn-inline",
    action?: string
  ): HTMLButtonElement {
    const control = el("button", {
      type: "button",
      className,
      textContent: text
    });
    control.setAttribute("aria-label", accessibleName);
    // A locale-independent hook (the visible text is translated).
    if (action) control.dataset.editorAction = action;
    control.addEventListener("click", onClick);
    return control;
  }

  /** Options of every rule's category select follow the declared categories. */
  function refreshCategoryOptions(): void {
    body
      .querySelectorAll<HTMLSelectElement>("select[data-rule-category]")
      .forEach((control) => {
        const index = Number(control.dataset.ruleCategory);
        const current = model.rules[index]?.categoryCode ?? "";
        control.textContent = "";
        const options: [string, string][] = [["", labels.fallbackCategory]];
        const declared = new Set<string>();
        for (const category of model.categories) {
          const code = category.code.trim();
          if (code && !declared.has(code)) {
            declared.add(code);
            options.push([code, code]);
          }
        }
        if (current && !declared.has(current)) {
          options.push([
            current,
            labels.undeclaredCategory.replace("{code}", current)
          ]);
        }
        for (const [value, text] of options) {
          const option = el("option", { value, textContent: text });
          option.selected = value === current;
          control.append(option);
        }
      });
  }

  function render(focus?: () => HTMLElement | null): void {
    body.textContent = "";

    // Categories ------------------------------------------------------------
    const categoriesSet = el("fieldset", { className: "tax-editor-group" });
    categoriesSet.append(el("legend", { textContent: labels.categories }));

    model.categories.forEach((category, index) => {
      const label = `${labels.category} ${index + 1}`;
      const row = el("fieldset", { className: "tax-editor-row" });
      row.append(el("legend", { textContent: label }));
      const code = textInput(
        category.code,
        (v) => (category.code = v),
        "code",
        {
          max: 63
        }
      );
      const name = textInput(
        category.name,
        (v) => (category.name = v),
        "name",
        {
          max: 120
        }
      );
      const description = textInput(
        category.description,
        (v) => (category.description = v),
        "description",
        { max: 500 }
      );
      row.append(
        field(labels.code, code),
        field(labels.name, name),
        field(labels.description, description),
        button(
          labels.remove,
          `${labels.remove}: ${label}`,
          () => {
            model.categories.splice(index, 1);
            sync();
            render(() => addCategory);
          },
          "btn-inline btn-inline--danger"
        )
      );
      categoriesSet.append(row);
    });

    const addCategory = button(
      labels.addCategory,
      labels.addCategory,
      () => {
        model.categories.push({ code: "", name: "", description: "" });
        sync();
        render(() => {
          const rows = categoriesSet.querySelectorAll(
            "fieldset.tax-editor-row"
          );
          return rows[rows.length - 1]?.querySelector("input") ?? null;
        });
      },
      "module-toggle",
      "add-category"
    );
    categoriesSet.append(addCategory);

    // Rules -----------------------------------------------------------------
    const rulesSet = el("fieldset", { className: "tax-editor-group" });
    rulesSet.append(el("legend", { textContent: labels.rules }));

    model.rules.forEach((rule, ruleIndex) => {
      const ruleLabel = `${labels.rule} ${ruleIndex + 1}`;
      const row = el("fieldset", { className: "tax-editor-row" });
      row.append(el("legend", { textContent: ruleLabel }));

      const categorySelect = el("select");
      categorySelect.dataset.ruleCategory = String(ruleIndex);
      categorySelect.addEventListener("change", () => {
        rule.categoryCode = categorySelect.value;
        sync();
      });

      const componentsBox = el("div", { className: "tax-editor-components" });
      const treatmentSelect = select(
        treatmentValues.map(
          (v) => [v, labels.treatments[v] ?? v] as [string, string]
        ),
        rule.treatment,
        (value) => {
          rule.treatment = value;
          if (value === "taxable" && rule.components.length === 0) {
            rule.components.push(emptyComponent());
          }
          render(() => treatmentSelect);
        }
      );

      row.append(
        field(labels.appliesTo, categorySelect),
        field(labels.treatment, treatmentSelect)
      );

      if (rule.treatment === "taxable") {
        const componentsSet = el("fieldset", {
          className: "tax-editor-group"
        });
        componentsSet.append(
          el("legend", { textContent: `${labels.components} (${ruleLabel})` })
        );

        rule.components.forEach((component, componentIndex) => {
          const componentLabel = `${labels.component} ${componentIndex + 1}`;
          const item = el("fieldset", { className: "tax-editor-row" });
          item.append(el("legend", { textContent: componentLabel }));
          const rate = textInput(
            component.rate,
            (v) => (component.rate = v),
            "rate",
            {
              decimal: true,
              placeholder: labels.rateHint
            }
          );
          const basis = select(
            basisValues.map(
              (v) => [v, labels.bases[v] ?? v] as [string, string]
            ),
            component.basis,
            (value) => (component.basis = value)
          );
          item.append(
            field(
              labels.code,
              textInput(component.code, (v) => (component.code = v), "code", {
                max: 63
              })
            ),
            field(
              labels.name,
              textInput(component.name, (v) => (component.name = v), "name", {
                max: 120
              })
            ),
            field(labels.rate, rate),
            field(labels.basis, basis),
            button(
              labels.remove,
              `${labels.remove}: ${componentLabel} (${ruleLabel})`,
              () => {
                rule.components.splice(componentIndex, 1);
                sync();
                render(() => addComponent);
              },
              "btn-inline btn-inline--danger"
            )
          );
          componentsSet.append(item);
        });

        if (rule.components.length === 0) {
          componentsSet.append(
            el("p", {
              className: "page-description",
              textContent: labels.noComponents
            })
          );
        }

        const addComponent = button(
          labels.addComponent,
          `${labels.addComponent} (${ruleLabel})`,
          () => {
            rule.components.push(emptyComponent());
            sync();
            render(() => {
              const items = componentsSet.querySelectorAll(
                "fieldset.tax-editor-row"
              );
              return items[items.length - 1]?.querySelector("input") ?? null;
            });
          },
          "module-toggle",
          "add-component"
        );
        addComponent.disabled =
          rule.components.length >= EDITOR_MAX_COMPONENTS_PER_RULE;
        componentsSet.append(addComponent);
        componentsBox.append(componentsSet);
      }

      row.append(
        componentsBox,
        button(
          labels.remove,
          `${labels.remove}: ${ruleLabel}`,
          () => {
            model.rules.splice(ruleIndex, 1);
            sync();
            render(() => addRule);
          },
          "btn-inline btn-inline--danger"
        )
      );
      rulesSet.append(row);
    });

    const addRule = button(
      labels.addRule,
      labels.addRule,
      () => {
        model.rules.push(emptyRule());
        sync();
        render(() => {
          const rows = rulesSet.querySelectorAll(
            ":scope > fieldset.tax-editor-row"
          );
          return rows[rows.length - 1]?.querySelector("select") ?? null;
        });
      },
      "module-toggle",
      "add-rule"
    );
    rulesSet.append(addRule);

    body.append(categoriesSet, rulesSet);
    refreshCategoryOptions();
    focus?.()?.focus();
  }

  // Textarea -> rows, when it parses into something the rows can show.
  textarea.addEventListener("input", () => {
    const parsed = loadEditableModel(textarea.value);
    if (parsed === null) {
      setEditable(false);
      return;
    }
    model = parsed;
    setEditable(true);
    render();
  });

  // Explicit, operator-chosen: replace the unshowable JSON with a blank model.
  resetButton.addEventListener("click", () => {
    model = initialModel();
    setEditable(true);
    sync();
    render();
  });

  if (editable) {
    sync();
    advanced.open = false;
  }
  setEditable(editable);
  render();
  mount.hidden = false;
}
