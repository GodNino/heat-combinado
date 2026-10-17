/** Asset names describe the lettering colour, not the background theme. */
export function HeatLogo() {
  return <span className="heat-logo" role="img" aria-label="HEAT">
    <img className="heat-logo-on-dark" src="/brand/heat-logo-light.svg" width="914" height="342" alt="" aria-hidden="true" />
    <img className="heat-logo-on-light" src="/brand/heat-logo-dark.svg" width="914" height="342" alt="" aria-hidden="true" />
  </span>;
}
export function HeatIcon() {
  return <img src="/brand/heat-icon.svg" width="28" height="28" className="heat-icon" alt="" aria-hidden="true" />;
}
