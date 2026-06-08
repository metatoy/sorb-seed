// Fully tokenized Button — every style value is a var(--…) reference.
// detectHardcoded MUST find 0 sites here (no false positives). Also a .tsx file
// so the typescript Babel plugin path is exercised.
import React from 'react'
import styled from 'styled-components'

type Props = { children: React.ReactNode }

export function Button({ children }: Props) {
  return (
    <button
      style={{
        backgroundColor: 'var(--button-primary-bg-default)',
        color: 'var(--button-primary-text-default)',
        borderColor: 'var(--button-primary-border-default)',
        borderRadius: 'var(--button-radius)',
      }}
    >
      {children}
    </button>
  )
}

export const StyledButton = styled.button`
  background: var(--button-primary-bg-default);
  border-radius: var(--button-radius);
  color: var(--button-primary-text-default);
`
