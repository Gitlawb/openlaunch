# Relay EVM order hashing: provenance and license

`relay-order.ts` contains the EVM/v1-only order type, EIP-712 struct schema,
normalizer, and order-ID hash algorithm extracted from the published
`@relay-protocol/settlement-sdk` **0.0.143** package by **Uneven Labs**.
The npm package metadata declares the **MIT** license and that author; no
copyright year is supplied here. The published tarball contains no separate
LICENSE file. The MIT notice below is retained with the extracted code.

## Exact upstream reference

- Package: [@relay-protocol/settlement-sdk 0.0.143](https://www.npmjs.com/package/@relay-protocol/settlement-sdk/v/0.0.143)
- Tarball: [settlement-sdk-0.0.143.tgz](https://registry.npmjs.org/@relay-protocol/settlement-sdk/-/settlement-sdk-0.0.143.tgz)
- Repository recorded in package metadata: `https://github.com/relayprotocol/settlement-protocol/packages/sdk`
- npm `gitHead`: `04d245b3701d5fe70baccaec0c6cc3a0a0827b96`
- npm tarball SHA-1: `44e2a9ab8c54754916614aba443b1aecb39b523f`
- npm tarball integrity: `sha512-+4oUYKmYA4SJ9CBRpfnrBFajGRx+sFuIBQZEkwjt/Dgte2fyL5qw0/5DQ1qGujqbzdCJC0oik/Ycjbg6y7z9MA==`
- `dist/order/index.js` SHA-256: `3dd837935b235da6b4f81322f3118362e630025af0e6edaebc6726c97a00a31b`
- `dist/utils.js` SHA-256: `004df8fef2733f9e5654b54c5fa4dadba9791386c2c2da26a2dcdc09f0a62d80`
- Type source: `dist/order/index.d.ts`, `Order` only.

The upstream repository was not publicly readable when checked. The immutable
versioned npm tarball is the retrievable source reference, not an assumed Git tag.

## Extraction boundary and verification

The schema fields and their order, all v1 normalization fields, the 20-byte EVM
address encoding, byte normalization, and `hashStruct` call with primary type
`Order` are unchanged. In particular, addresses are not padded to 32 bytes and
the order ID does not use a typed-data domain hash. CommonJS compiler wrappers
were removed, TypeScript annotations restored, EVM helpers inlined, and a
`server-only` boundary added. Local guards explicitly reject versions other than
v1, non-EVM chains (including the solver and empty-output cases), and inherited
chain-map properties. No signing, settlement, or non-EVM code was copied.

Before removing the SDK dependency, the full schema, normalized objects, and
hashes were compared against the installed official 0.0.143 implementation for
256 deterministic EVM/v1 vectors. These cover multiple inputs, refunds,
payments, fees and calls; mixed-case hex; variable-length bytes; zero values;
uint256 boundaries; uint32 deadline boundaries; and three chain identifiers.
`relay-order.golden.ts` records all 256 **official SDK** order IDs, indexed by
the generator in `relay-order.vectors.ts`. The persisted suite also checks the
independently captured provider order ID in `relay.fixture.ts` and the added
fail-closed guards. This is compatibility verification, not a security audit.

The narrow extraction avoids bringing unrelated multi-chain dependencies and
their known vulnerabilities into the server. It uses the application's existing
Viem dependency. Do not update the protocol schema without reviewing upstream
source, regenerating reference vectors against that exact upstream version, and
rechecking read-only live quotes across all supported asset routes.

## MIT License

Copyright (c) Uneven Labs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
