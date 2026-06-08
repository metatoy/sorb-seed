// Legacy-styled Button fixture — hardcoded color + dimension values, no tokens.
// Known hardcoded style sites (the P0 acceptance count). Inline style object:
//   1. backgroundColor '#0F65EF'   (bg)
//   2. color           '#ffffff'   (text)
//   3. borderColor     '#0f65ef'   (border)
//   4. borderRadius     4          (radius, numeric)
//   5. padding         '8px'       (no role → tier-only)
// styled-components block:
//   6. background      '#0F65EF'   (bg)
//   7. border-radius   '4px'       (radius)
//   8. color           '#FFFFFF'   (text)
// Total = 8 hardcoded sites. (The `border` declaration below intentionally uses
// only a var() + a keyword so it adds NO hardcoded sites.)
import React from 'react'
import styled from 'styled-components'

export function Button({ children }) {
  return (
    <button
      style={{
        backgroundColor: '#0F65EF',
        color: '#ffffff',
        borderColor: '#0f65ef',
        borderRadius: 4,
        padding: '8px',
      }}
    >
      {children}
    </button>
  )
}

export const StyledButton = styled.button`
  background: #0F65EF;
  border-radius: 4px;
  color: #FFFFFF;
  border: var(--border-width, 1px) solid currentColor;
`
