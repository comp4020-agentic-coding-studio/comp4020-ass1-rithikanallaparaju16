---
name: Metabolic Clarity
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45464d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#006c49'
  on-secondary: '#ffffff'
  secondary-container: '#6cf8bb'
  on-secondary-container: '#00714d'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#2a1700'
  on-tertiary-container: '#b87500'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#6ffbbe'
  secondary-fixed-dim: '#4edea3'
  on-secondary-fixed: '#002113'
  on-secondary-fixed-variant: '#005236'
  tertiary-fixed: '#ffddb8'
  tertiary-fixed-dim: '#ffb95f'
  on-tertiary-fixed: '#2a1700'
  on-tertiary-fixed-variant: '#653e00'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  display-lg:
    fontFamily: Inter
    fontSize: 48px
    fontWeight: '700'
    lineHeight: 56px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Inter
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-caps:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  data-mono:
    fontFamily: Geist
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  unit: 8px
  container-max: 1200px
  gutter: 24px
  margin-mobile: 16px
  stack-sm: 12px
  stack-md: 24px
  stack-lg: 48px
---

## Brand & Style

The design system is engineered for a high-trust, scientific narrative that remains accessible to a general audience. The brand personality is authoritative yet empathetic, focusing on clarity, precision, and the "living" nature of metabolic data.

The design style is **Corporate / Modern** with a lean toward **Minimalism**. It prioritizes heavy whitespace to reduce cognitive load during complex data visualization. Information is organized through clear visual hierarchies, utilizing subtle transitions and a refined aesthetic to make biological processes feel manageable rather than overwhelming. The interface should feel like a premium laboratory tool—precise, clean, and reliable.

## Colors

The palette is functional and semantic, designed to communicate health status at a glance.

- **Primary (#0F172A):** Deep health-tech blue used for core structural elements, primary navigation, and high-contrast typography. It establishes authority.
- **Secondary (#10B981):** "Metabolic Green" represents homeostasis and healthy physiological ranges. Used for positive trends, "optimal" zones, and successful outcomes.
- **Accent (#F59E0B):** "Spike Amber" signals caution. This is reserved for glucose spikes, insulin surges, or elements requiring immediate user attention within the interactive curve.
- **Background (#F8FAFC):** A cool neutral gray that provides a crisp canvas for data overlays, ensuring that the semantic colors (Green/Amber) remain the primary focus.
- **Surface:** Pure White (#FFFFFF) is used for interactive cards and containers to separate them from the foundational background.

## Typography

This design system utilizes **Inter** for its systematic, utilitarian, and highly legible characteristics. It ensures that complex terminology is easily digestible.

- **Display & Headlines:** Used for section titles and primary metabolic stats. Tighten letter spacing on larger sizes to maintain a modern, "engineered" look.
- **Body Text:** Standardized on a 16px base for optimal readability of long-form scientific explanations.
- **Labels:** Uppercase labels are used for axis titles in charts and small metadata tags.
- **Data Mono:** While the system is sans-serif, use a monospaced font (Geist) specifically for numerical values within charts and sliders to prevent "jumping" layouts during real-time interaction.

## Layout & Spacing

The layout follows a **Fixed Grid** philosophy for the central explainer content to ensure precise alignment of the "Plate" and "Chart" areas.

- **Desktop (1200px+):** 12-column grid. The "Plate" area (interactive input) occupies the left 5 columns, while the "Glucose Curve" (output) occupies the right 7 columns.
- **Tablet:** 8-column grid. Layout shifts to a vertical stack: Plate on top, Chart below.
- **Mobile:** 4-column grid. Margins reduce to 16px. Interactive elements like sliders are full-width for touch ergonomics.

Spacing follows a strict 8px linear scale. Use `stack-lg` (48px) to separate major sections like the Food Library from the Interactive Explainer.

## Elevation & Depth

To maintain a clean, scientific aesthetic, the design system utilizes **Tonal Layers** combined with **Low-contrast Outlines**.

- **Level 0 (Background):** #F8FAFC. The base layer for the entire application.
- **Level 1 (Cards/Containers):** #FFFFFF. Used for food item cards and the chart container. These feature a subtle 1px border (#E2E8F0) and a very soft, diffused shadow (0px 4px 6px rgba(15, 23, 42, 0.05)).
- **Level 2 (Interactive Overlays):** Used for tooltips on the glucose curve. These use a slightly darker border (#CBD5E1) to pop against the white cards.
- **Active State:** When a food item is "on the plate," it gains a subtle secondary color glow (Metabolic Green) instead of a heavy shadow, indicating its active role in the simulation.

## Shapes

The shape language is **Soft**, balancing technical precision with an approachable feel.

- **Standard UI (Buttons, Inputs):** 0.25rem (4px). This maintains a crisp, professional edge.
- **Containers (Cards, Chart Area):** 0.5rem (8px). This softens the large surface areas.
- **The "Plate":** A perfect circle. This is the only outlier in the shape language, serving as the visual anchor and metaphor for the interactive experience.
- **Interactive Toggles:** Pill-shaped (1rem+) to clearly distinguish them as draggable or clickable control elements.

## Components

### Food Cards
Small, modular units containing a food icon, name, and "glycemic impact" sparkline. On click, they animate smoothly toward the central plate. Use a 1px border (#E2E8F0) and transition to a Metabolic Green border when selected.

### The Metabolic Plate
A large, circular drop zone. It should feature a subtle "pulsing" inner border when a food item is dragged over it. Use a soft background blur if items overlap.

### Interactive Sliders
Used for activity levels (e.g., "Post-meal walk"). The track should be a neutral gray (#E2E8F0) with a Primary Blue (#0F172A) thumb. Numerical values should update in real-time above the thumb using the `data-mono` font.

### The Glucose Chart
The centerpiece of the system. 
- **The Curve:** Use a thick (3px) line. It should transition color dynamically: Secondary Green for values <140mg/dL, and Accent Amber for values >140mg/dL.
- **Grid Lines:** Minimal, using high-transparency grays.
- **Area Fill:** A very light gradient fill under the curve (5% opacity) that matches the line color.

### Toggles
Switch-style toggles for binary states (e.g., "Insulin Sensitivity: High/Normal"). Use the Secondary Green for the 'On' state to reinforce the health-tech theme.

### Primary Action Buttons
Solid Primary Blue (#0F172A) with white text. Use 4px roundedness. For "Reset" or secondary actions, use an outline button with #64748B text and border.