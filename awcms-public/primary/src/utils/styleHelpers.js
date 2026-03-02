export const generateInlineStyles = (props) => {
  const style = {};

  // Spacing
  if (props.marginTop) style.marginTop = props.marginTop;
  if (props.marginRight) style.marginRight = props.marginRight;
  if (props.marginBottom) style.marginBottom = props.marginBottom;
  if (props.marginLeft) style.marginLeft = props.marginLeft;

  if (props.paddingTop) style.paddingTop = props.paddingTop;
  if (props.paddingRight) style.paddingRight = props.paddingRight;
  if (props.paddingBottom) style.paddingBottom = props.paddingBottom;
  if (props.paddingLeft) style.paddingLeft = props.paddingLeft;

  // Background & Border
  if (props.backgroundColor) style.backgroundColor = props.backgroundColor;
  if (props.borderRadius) style.borderRadius = props.borderRadius;

  // Typography
  if (props.textColor) style.color = props.textColor;
  if (props.textAlign && props.textAlign !== "inherit")
    style.textAlign = props.textAlign;

  // Convert object to CSS string for Astro
  return Object.entries(style)
    .map(([key, value]) => {
      const cssKey = key.replace(/([A-Z])/g, "-$1").toLowerCase();
      return `${cssKey}: ${value};`;
    })
    .join(" ");
};
