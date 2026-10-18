# X2F: where is it regulated? A jurisdictions brief for the crypto lawyer

**As of 18 October 2026.** Prepared by an AI research assistant for the owner's meeting with a crypto lawyer.

> **This is not legal advice.** It is background research to make the meeting faster. Laws and enforcement change often. Every claim below has a link, and uncertain points are marked **[unverified]** or **[secondary source]**. Primary sources (statutes, regulators) were opened where possible. Where only news or law-firm summaries were available, that is said. The lawyer should check every point that matters.

## What X2F is, in legal terms

These are the facts a lawyer will look at, taken from the design spec (sections 1, 3, 4, 11) and HANDOFF.md:

- A central company runs the website, the matching of ads, the message relay, and moderators who settle disputes.
- Each trade uses a fresh 2-of-3 Monero multisig: buyer, seller and an X2F moderator key. X2F holds at most one key. Its server can sign automatically only a refund of the whole balance to the seller's own recorded address.
- In a dispute, a human moderator plus one trader can move the coins. So X2F decides who gets the coins, but cannot move them alone.
- X2F never holds user balances. It takes a 1% fee as a separate output of the escrow release, paid by the ad poster.
- No KYC (no name, email or phone). No IP logging. Tor supported.
- The asset is Monero, which many regulators class as an "anonymity-enhancing" or "privacy" coin.
- Web app first; iOS and Android store apps later.

## Bottom line

In almost every major market we checked, the law catches not only businesses that hold coins but also those that "arrange", "facilitate" or "act as intermediary" in crypto-for-fiat trades. X2F's central operator, moderators, dispute decisions and 1% fee make it look like such an intermediary, not a "fully decentralised" protocol. The strongest argument that X2F is *not* a regulated money transmitter is US federal: FinCEN's 2019 guidance says a pure P2P bulletin board, and a multisig provider that lacks "total independent control", are not money transmitters ([FinCEN FIN-2019-G001](https://www.fincen.gov/sites/default/files/2019-05/FinCEN%20Guidance%20CVC%20FINAL%20508.pdf), §§4.2.2, 5.1). Even there, the Samourai and Tornado Cash convictions show prosecutors will test that line, and US state law is unclear. The UK, EU, Singapore, Australia, Japan, South Korea, India, South Africa, Argentina, Brazil and Turkey all appear to require registration or a licence, with KYC, for a platform like X2F. On top of that, Monero itself is effectively off-limits to licensed providers in Japan, South Korea and Dubai, and will be across the EU from 10 July 2027 ([AMLR Art. 79 and 90](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1624)). So for X2F, "get licensed" is often not even possible while keeping Monero and no-KYC. The realistic choices are: (a) a carefully chosen home country plus geoblocking of hostile markets, (b) redesigning toward true decentralisation (no operator-run moderation or fee), or (c) accepting legal risk knowingly. App stores follow licences: Apple and Google will in practice block an unlicensed P2P exchange app in the US, EU, UK, Canada, Japan, Korea, UAE and South Africa.

## Summary table

Status key: **Regulated** = registration or licence (and KYC) likely needed. **Likely not** = good argument X2F falls outside. **Unclear** = genuinely open. **Banned** = crypto trading or Monero itself prohibited.

| Country | Likely status for X2F | Why (one line) | Key source |
|---|---|---|---|
| United States (federal) | Unclear (best case "likely not") | FinCEN: a P2P forum where parties settle in their own wallets, and a multisig provider without "total independent control", are not money transmitters; but X2F also arbitrates and takes a fee from escrow | [FinCEN 2019 guidance](https://www.fincen.gov/sites/default/files/2019-05/FinCEN%20Guidance%20CVC%20FINAL%20508.pdf) |
| United States (states) | Unclear | State money-transmitter laws and California's DFAL turn on "control"; no clean answer for a one-of-three key holder | [CSBS model law](https://www.csbs.org/sites/default/files/2023-02/CSBS%20Money%20Transmission%20Modernization%20Act.pdf), [DFPI DFAL FAQ](https://dfpi.ca.gov/regulated-industries/digital-financial-assets/digital-financial-assets-law-frequently-asked-questions/) |
| European Union | Regulated, and XMR blocked from July 2027 | Looks like "operation of a trading platform" under MiCA; not "fully decentralised"; AMLR bars CASPs from anonymity-enhancing coins | [MiCA](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R1114), [AMLR](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1624) |
| United Kingdom | Regulated | MLRs catch anyone "arranging or making arrangements" for crypto-fiat exchange; FCA warned against LocalCoinSwap and is raiding unregistered P2P traders | [MLR reg. 14A](https://www.legislation.gov.uk/uksi/2017/692/regulation/14A), [FCA warning](https://www.fca.org.uk/news/warnings/localcoinswap-localcoinswapcom) |
| Canada | Unclear, leaning regulated | "Dealing in virtual currency" (exchange) needs FINTRAC MSB registration, including foreign MSBs directing services at Canada; P2P platforms not addressed | [FINTRAC MSB page](https://fintrac-canafe.canada.ca/msb-esm/msb-eng) |
| Switzerland | Unclear, leaning regulated | AMLA financial-intermediary test no longer depends only on power of disposal; operator whose service is needed to use the tech can be caught | [FINMA 02/2019](https://www.finma.ch/en/news/2019/08/20190826-mm-kryptogwg/), [PwC](https://pwc.ch/en/insights/regulation/swiss-dlt-new-regulations.html) |
| Singapore | Regulated | Since April 2024 the Payment Services Act covers "facilitating the exchange" of tokens even without possession; Singapore-based firms serving only foreigners also need a licence | [MAS DTSP release](https://www.mas.gov.sg/news/media-releases/2025/mas-clarifies-regulatory-regime-for-digital-token-service-providers) |
| Japan | Regulated; XMR effectively barred | "Intermediary, brokerage or agency" in crypto trades is a crypto-asset exchange service; FSA pushed exchanges to drop XMR; FSA had Apple pull unregistered exchange apps | [Payment Services Act Art. 2](https://www.japaneselawtranslation.go.jp/en/laws/view/3965/en) |
| South Korea | Regulated; XMR effectively barred | VASPs must report to the FIU; "dark coins" barred for VASPs since 2021; unregistered foreign exchange apps blocked | [Cointelegraph](https://cointelegraph.com/news/south-korean-financial-watchdog-to-ban-privacy-coins), [Decrypt](https://decrypt.co/314786/south-korea-blocks-apps-crypto-exchanges-apple-google-stores) |
| Australia | Regulated | From 31 March 2026, item 50A covers "making arrangements" for crypto-fiat exchange, which AUSTRAC says may include operating a P2P platform | [AUSTRAC VASP reform](https://www.austrac.gov.au/about-us/amlctf-reform/reforms-guidance/before-you-start/new-industries-and-services-be-regulated-reform/virtual-asset-services-reform) |
| UAE / Dubai | Banned for XMR | VARA prohibits anonymity-enhanced cryptocurrencies and all activity related to them | [VARA Rulebook](https://rulebooks.vara.ae/rulebook/b-prohibited-virtual-assets) |
| Brazil | Regulated | Central Bank PSAV regime in force from 2 February 2026; "intermediária" licence category; local entity required | [BCB press note](https://www.bcb.gov.br/en/pressdetail/2639/nota) |
| Argentina | Regulated | CNV PSAV registry applies to resident and non-resident providers serving Argentina (small-volume exemption) | [Blog del Contador on RG 994](https://blogdelcontador.com.ar/cnv-oficializa-regulacion-cripto-en-argentina-que-es-y-para-que-servira-el-registro-proveedores-de-servicios-de-activos-virtuales-psav/) |
| Mexico | Regulated (AML reporting) | Crypto exchange via platforms is a "vulnerable activity" under the AML law, including operations with Mexicans from abroad | [CryptoSlate profile](https://cryptoslate.com/crypto-laws/mexico-lfpiorpi-article-17-xvi-virtual-asset-aml-regime/) |
| Nigeria | Regulated; hostile to P2P | ISA 2025 puts VASPs under the SEC; government targeted Binance P2P and naira P2P trading in 2024 | [Mondaq on ISA 2025](https://webiis10.mondaq.com/nigeria/fin-tech/1623238/what-the-investment-and-securities-act-2025-means-for-digital-and-virtual-assets-in-nigeria) |
| South Africa | Regulated | CASPs are FICA accountable institutions; crypto "intermediary services" need an FSCA licence, including for foreign providers | [Bizmag summary](https://bizmag.co.za/crypto-asset-service-providers-the-travel-rule-and-regulatory-reporting/) |
| India | Regulated; offshore blocked | Offshore VDA providers must register with FIU-IND; unregistered ones (incl. Paxful, ChangeNow) get URL blocks | [PIB Sept 2026](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2308131&reg=48&lang=2) |
| Turkey | Regulated | Law 7518 (2024) requires a Capital Markets Board licence for crypto-asset service providers | [Mondaq](https://www.mondaq.com/turkey/fin-tech/1496058/new-legislative-changes-regarding-crypto-asset-services-in-turkey) |
| El Salvador | Unclear | Bitcoin providers register with the central bank; other digital-asset providers fall under the CNAD; XMR treatment not confirmed | [CriptoNoticias](https://www.criptonoticias.com/negocios/apenas-11-empresas-bitcoin-registro-elsalvador-operativas) |
| China | Banned | All crypto exchange and matching services are illegal, including offshore services to mainland residents | [CMS](https://cms.law/en/chn/legal-updates/china-imposes-strict-bans-on-virtual-currencies) |
| Algeria, Bangladesh, Egypt, Iraq, Morocco, Nepal, Qatar, Tunisia | Banned (as of 2021; recheck) | Listed with China as "absolute ban" jurisdictions by the US Law Library of Congress | [LoC 2021 report](https://tile.loc.gov/storage-services/service/ll/llglrd/2021687419/2021687419.pdf) |

## Per-country notes

### United States — federal (FinCEN, DOJ)

- **The helpful rule.** FinCEN says a trading platform that "only provides a forum where buyers and sellers of CVC post their bids and offers", where the parties settle "through individual wallets or other wallets not hosted by the trading platform", is not a money transmitter. If the platform buys from the seller and sells to the buyer, it is ([FIN-2019-G001 §5.1](https://www.fincen.gov/sites/default/files/2019-05/FinCEN%20Guidance%20CVC%20FINAL%20508.pdf)).
- **Multisig.** A multisig wallet provider that only adds a second key, where the provider "does not have total independent control over the value", is not a money transmitter. It becomes one if it also hosts wallets, or "maintains total independent control" ([§4.2.2](https://www.fincen.gov/sites/default/files/2019-05/FinCEN%20Guidance%20CVC%20FINAL%20508.pdf)). X2F's design (one of three keys; auto-sign only to the seller's refund address) fits this well on paper.
- **The weak spots.** (1) FinCEN's §5.1 also says platforms "sometimes ... facilitate trades as an intermediary"; X2F runs the escrow and decides disputes. (2) X2F's fee comes out of the escrow as an output. A lawyer should say whether that counts as "accepting" value. (3) FinCEN says anonymizing *service* providers that accept and transmit value are money transmitters (§4.5.1); X2F is not a mixer, but Monero plus no KYC plus Tor will attract the comparison.
- **Enforcement.** Samourai Wallet's founders pleaded guilty to conspiracy to run an unlicensed money-transmitting business and got 5 and 4 years in November 2025 ([DOJ SDNY](https://www.justice.gov/usao-sdny/pr/founders-samourai-wallet-cryptocurrency-mixing-service-sentenced-five-and-four-years)). Roman Storm (Tornado Cash) was convicted on the same unlicensed money-transmitting conspiracy count in August 2025; retrial on the hung counts is set for 26 April 2027 and his acquittal motion is pending ([The Block](https://theblock.co/news/regulation/2026-08-26-tornado-cash-roman-storm-retrial-april-2027-412761)). Paxful, a custodial P2P marketplace, pleaded guilty in December 2025 to unlicensed money transmission, BSA and Travel Act counts ([Charltons Quantum](https://charltonsquantum.com/us-doj-sentences-paxful-holdings-inc-to-usd-4-million-criminal-penalty-for-travel-act-and-bank-secrecy-act-violations/)) **[secondary source]**.
- **Policy softening, not law.** In August 2025 a senior DOJ official said DOJ would no longer bring new §1960(b)(1)(C) charges against developers of truly decentralised, non-custodial software without criminal intent ([The Block](https://www.theblock.co/post/367858/writing-code-without-ill-intent-is-not-a-crime-says-us-doj-official-following-tornado-cash-verdict)) **[secondary source]**. X2F is a run service, not just software, so this may not help. OFAC lifted Tornado Cash sanctions in March 2025 after the Fifth Circuit held immutable smart contracts are not "property" ([Willkie](https://complianceconcourse.willkie.com/articles/united-states-removes-economic-sanctions-against-tornado-cash/)).
- **Pending law.** The CLARITY Act includes the Blockchain Regulatory Certainty Act (non-controlling developers are not money transmitters). The Senate cloture vote failed 49–50 on 15 September 2026; it is not law ([ABA Banking Journal](https://bankingjournal.aba.com/2026/08/senate-adjourns-with-no-vote-on-clarity-act/), [DeFi Rate](https://defirate.com/clarity-act-fact-sheet/)) **[secondary source; check Congress.gov]**.

### United States — states

- Each state licenses money transmitters. The CSBS model law defines "control" of virtual currency as the power to "execute unilaterally or prevent indefinitely" a transaction ([CSBS MTMA](https://www.csbs.org/sites/default/files/2023-02/CSBS%20Money%20Transmission%20Modernization%20Act.pdf)). Which states adopted that article is **[unverified]**. Note: X2F's moderator key can *prevent* a dispute outcome indefinitely by refusing to sign. Ask whether that is "control".
- California's Digital Financial Assets Law required a licence for digital-asset business with California residents from 1 July 2026 ([DFPI FAQ](https://dfpi.ca.gov/regulated-industries/digital-financial-assets/digital-financial-assets-law-frequently-asked-questions/)).
- New York's BitLicense is the strictest state regime **[not researched in detail]**.

### European Union (MiCA, AMLR)

- **Who is a CASP.** Crypto services include "operation of a trading platform", "exchange of crypto-assets for funds" and "reception and transmission of orders" ([MiCA Art. 3(1)(16)](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R1114)). A trading platform is a multilateral system that brings together third-party buying and selling interests "in the system and in accordance with its rules, in a way that results in a contract" (Art. 3(1)(18)). X2F's ad book, trade flow and dispute rules fit this description closely. "Exchange for funds" requires using proprietary capital (Art. 3(1)(19)), which X2F does not.
- **The "fully decentralised" carve-out.** Recital 22: services "provided in a fully decentralised manner without any intermediary" are out of scope. X2F has a central operator and moderators, so this is unlikely to apply.
- **Privacy coins.** A licensed trading platform's rules must prevent admission of crypto-assets "that have an inbuilt anonymisation function" unless holders and history can be identified (MiCA Art. 76(3)). From **10 July 2027**, CASPs may not keep accounts allowing anonymisation "including through anonymity-enhancing coins" ([AMLR Art. 79(1), Art. 90](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1624)). The ban does not apply to providers of hardware, software or self-hosted wallets that do not "possess access to or control over" the wallets (AMLR recital 160). Whether X2F's one-of-three key is "access or control" is a key question.
- **Transition.** The MiCA grandfathering period ended no later than 1 July 2026 (Art. 143(3)).
- **Market effect.** Kraken delisted XMR across the EEA on 31 October 2024, citing regulatory changes ([Cointelegraph](https://cointelegraph.com/news/kraken-ends-monero-support-european-economic-area)).

### United Kingdom

- A "cryptoasset exchange provider" includes anyone who by way of business provides "exchanging, or arranging or making arrangements with a view to the exchange of, cryptoassets for money" ([MLR 2017 reg. 14A](https://www.legislation.gov.uk/uksi/2017/692/regulation/14A)). It must register with the FCA.
- **"Peer-to-peer provider."** This phrase came from HM Treasury's 2019 consultation; it is not a separate defined term in reg. 14A as enacted. Treasury's response said a "centralised entity that is completing, matching or authorising a transaction between two people" could be brought into scope, and it proceeded on that basis ([HMT 5MLD response, para 2.20](https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/860491/5MLD_Consultation_Response.pdf)). X2F matches and, through its moderator key, helps authorise.
- **Enforcement.** The FCA put LocalCoinSwap (a P2P marketplace) on its warning list on 10 June 2025 as not registered and possibly targeting UK users ([FCA](https://www.fca.org.uk/news/warnings/localcoinswap-localcoinswapcom)). In April and September 2026 the FCA, HMRC and police served cease-and-desist letters on unregistered P2P traders; the FCA says no solely-P2P business is registered and "anyone running an unregistered peer-to-peer crypto business should assume we are looking at them" ([FCA, 17 Sept 2026](https://www.fca.org.uk/news/press-releases/fca-and-partners-continues-crackdown-illegal-crypto-trading)).
- **New regime.** Full FSMA authorisation for crypto activities (including operating a trading platform and arranging deals) starts 25 October 2027; applications opened 30 September 2026; overseas firms serving UK retail will need UK authorisation ([FCA PS26/18](https://www.fca.org.uk/publications/policy-statements/ps26-18-cryptoasset-perimeter-guidance), [Regulation Tomorrow](https://www.regulationtomorrow.com/2025/12/hmt-announces-final-cryptoasset-regulatory-regime-legislation/)).

### Canada

- Dealing in virtual currency (exchange or transfer) is an MSB activity requiring FINTRAC registration. A foreign MSB must register if it directs services at Canada, for example by marketing to Canadians, using a .ca domain or pricing in CAD ([FINTRAC](https://fintrac-canafe.canada.ca/msb-esm/msb-eng)).
- FINTRAC's guidance does not address P2P matching platforms. Its red-flag list treats P2P ads at commercial scale as a sign of an unregistered MSB ([FINTRAC indicators](https://fintrac-canafe.canada.ca/guidance-directives/transaction-operation/indicators-indicateurs/vc_mltf-eng)). Provincial securities rules for crypto trading platforms were **[not researched]**.

### Switzerland

- FINMA Guidance 02/2019 applies AML rules to blockchain transfers and is strict on transfers to external wallets ([FINMA](https://www.finma.ch/en/news/2019/08/20190826-mm-kryptogwg/)). Older commentary says a pure P2P platform with no transfers through the operator's wallets is outside those obligations ([Mondaq](https://www.mondaq.com/fin-tech/843804/practical-implications-of-the-new-finma-guidance-on-payments-on-the-blockchain)).
- Newer rules: being a financial intermediary "no longer solely depends" on power of disposal; a provider whose service is necessary to use the technical solution can be caught ([PwC](https://pwc.ch/en/insights/regulation/swiss-dlt-new-regulations.html)) **[secondary source]**. X2F's moderator key is needed for disputes and refunds. Likely SRO membership and KYC.

### Singapore

- From 4 April 2024 the Payment Services Act covers facilitating the exchange of digital payment tokens even where the provider never possesses money or tokens ([Clyde & Co](https://www.clydeco.com/en/insights/2024/04/singapore-payment-services-act-to-now-cover-token)) **[secondary source; statute site blocked our fetch]**.
- From 30 June 2025 Singapore-based firms serving only overseas customers need a licence, which MAS "will generally not issue" ([MAS](https://www.mas.gov.sg/news/media-releases/2025/mas-clarifies-regulatory-regime-for-digital-token-service-providers)). Do not base X2F in Singapore.

### Japan

- "Crypto-asset exchange services" include "intermediary, brokerage or agency services" for crypto trades ([Payment Services Act Art. 2](https://www.japaneselawtranslation.go.jp/en/laws/view/3965/en)). A 2025 amendment added a separate intermediary category **[unverified detail]**. In July 2026 the Diet passed a law moving crypto into the Financial Instruments and Exchange Act, raising penalties for unregistered operators to up to 10 years ([The Block](https://www.theblock.co/post/408361/japan-passes-key-bill)) **[secondary source; start date unclear]**.
- In 2018 the FSA pressed exchanges to drop XMR, ZEC and Dash ([Crowdfund Insider](https://www.crowdfundinsider.com/2018/05/132808-japan-regulators-urging-crypto-exchanges-to-exclude-anonymous-altcoins/)). In February 2025 the FSA asked Apple and Google to remove five unregistered exchange apps; Apple did ([The Block](https://www.theblock.co/post/339501/japan-apple-google-block-crypto-apps)).

### South Korea

- VASPs must report to the Korea FIU; overseas operators targeting Koreans (Korean website, KRW support) must too, with penalties up to 5 years' prison ([Decrypt](https://decrypt.co/314786/south-korea-blocks-apps-crypto-exchanges-apple-google-stores)).
- Since March 2021 VASPs may not handle "dark coins" such as XMR ([Cointelegraph](https://cointelegraph.com/news/south-korean-financial-watchdog-to-ban-privacy-coins)) **[secondary source]**. Google and Apple blocked 17 and 14 unregistered exchange apps in Korea in 2025 ([Cointelegraph](https://cointelegraph.com/news/google-play-blocks-17-unregistered-crypto-exchanges-south-korea)).

### Australia

- From 31 March 2026, virtual-asset-for-money exchange (item 50A) carries full AML/CTF obligations ([AUSTRAC transitional rules](https://www.austrac.gov.au/about-us/legislation/updates-legislation/amlctf-transitional-rules-2026)). AUSTRAC says a provider need not perform every step and that "making arrangements" may include operating a platform for P2P exchange ([AUSTRAC](https://www.austrac.gov.au/about-us/amlctf-reform/reforms-guidance/before-you-start/new-industries-and-services-be-regulated-reform/virtual-asset-services-reform)) **[read via search excerpt; page blocked our direct fetch]**.

### UAE / Dubai

- VARA prohibits issuing anonymity-enhanced cryptocurrencies and all virtual-asset activity related to them in Dubai, and bans marketing them into the UAE ([VARA Rulebook](https://rulebooks.vara.ae/rulebook/b-prohibited-virtual-assets), [VARA licensed activities](https://www.vara.ae/en/licenses-and-register/licensed-activities/)). Unlicensed virtual-asset activity is barred onshore under Cabinet Decision 111/2022 ([Bird & Bird](https://twobirds.com/en/insights/2023/uae/the-new-dubai-virtual-asset-regime)). Treat as banned for an XMR service.

### Brazil

- BCB Resolutions 519–521 (in force 2 February 2026) set up licensed PSAVs in three types: intermediária, custodiante, corretora ([BCB](https://www.bcb.gov.br/en/pressdetail/2639/nota)). A local entity is required, and firms already operating had to file for authorisation by a 2026 deadline (reported as 1 October or 30 October 2026) **[conflicting secondary sources]**. How this reaches an offshore platform serving Brazilians is **[unverified]**.

### Argentina

- CNV RG 994/2024 requires PSAVs serving Argentina to register, resident or not, with an exemption under 35,000 UVA a month; RG 1058/2025 added operating rules ([Blog del Contador](https://blogdelcontador.com.ar/cnv-oficializa-regulacion-cripto-en-argentina-que-es-y-para-que-servira-el-registro-proveedores-de-servicios-de-activos-virtuales-psav/), [Microjuris](https://aldiaargentina.microjuris.com/2025/09/24/legislacion-cnv-nueva-reglamentacion-para-proveedores-de-servicios-de-activos-virtuales-psav/)) **[secondary sources]**.

### Mexico

- Habitual, professional crypto exchange through platforms is a "vulnerable activity" under the AML law (LFPIORPI Art. 17-XVI), with KYC and reporting to the SAT; the July 2025 reform reportedly also covers operations with Mexicans from other jurisdictions ([CryptoSlate](https://cryptoslate.com/crypto-laws/mexico-lfpiorpi-article-17-xvi-virtual-asset-aml-regime/)) **[secondary source]**.

### Nigeria

- The Investments and Securities Act 2025 treats digital assets as securities and requires VASPs and digital-asset exchanges to register with the SEC, possibly including foreign operators targeting Nigerians ([Mondaq](https://webiis10.mondaq.com/nigeria/fin-tech/1623238/what-the-investment-and-securities-act-2025-means-for-digital-and-virtual-assets-in-nigeria)). In 2024 the government detained Binance staff, Binance removed naira P2P, and the SEC said it would delist naira from P2P platforms ([Cointelegraph](https://cointelegraph.com/news/binance-drops-naira-government-scrutiny), [BusinessDay](https://businessday.ng/technology/article/crypto-crackdown-sec-to-delist-naira-from-p2p-platforms/)). High risk for a P2P fiat ramp.

### South Africa

- CASPs are accountable institutions (FICA Schedule 1 item 22). Crypto advice or intermediary services need an FSCA licence, including for foreign providers serving South Africans. The travel rule (Directive 9) applies from 30 April 2025 ([Bizmag](https://bizmag.co.za/crypto-asset-service-providers-the-travel-rule-and-regulatory-reporting/), [Moonstone](https://www.moonstone.co.za/no-exemptions-all-casps-must-adopt-travel-rule-directive/)) **[secondary sources]**.

### India

- Virtual digital asset providers became PMLA reporting entities in March 2023. FIU-IND has served notices and sought URL blocks on unregistered offshore providers: 9 in December 2023, 25 in October 2025 (including Paxful), and 15 in September 2026 (including ChangeNow and SimpleSwap) ([PIB 2023](https://www.pib.gov.in/PressReleasePage.aspx?PRID=1991372&reg=48&lang=2), [PIB 2025](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2173758&reg=48&lang=2), [PIB 2026](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2308131&reg=48&lang=2)). Instant-swap services popular with Monero users are now targets.

### Turkey

- Law 7518 (July 2024) brought crypto-asset service providers under the Capital Markets Board, with licensing communiqués in March 2025 ([Mondaq](https://www.mondaq.com/turkey/fin-tech/1496058/new-legislative-changes-regarding-crypto-asset-services-in-turkey), [CryptoSlate](https://cryptoslate.com/crypto-laws/turkey-cmb-communique-iii-35-b-1-crypto-asset-service-provider-rules/)) **[secondary sources]**. Treatment of foreign platforms and privacy coins **[unverified]**.

### El Salvador

- January 2025 reforms made bitcoin acceptance voluntary as part of an IMF deal ([Cointelegraph](https://cointelegraph.com/news/el-salvador-bitcoin-status-btc-law-amendment)). Bitcoin service providers register with the central bank (BCR); other digital-asset providers register with the CNAD under the Digital Assets Issuance Law ([CriptoNoticias](https://www.criptonoticias.com/negocios/apenas-11-empresas-bitcoin-registro-elsalvador-operativas), [Global Law Experts](https://globallawexperts.com/bitcoin-service-provider-licence-el-salvador/)) **[secondary sources]**. A Monero P2P platform would likely need CNAD registration **[unverified]**.

### Bans

- **China:** the September 2021 notice makes crypto exchange, central-counterparty trading and "matching services" illegal financial activities, including offshore services to mainland residents ([CMS](https://cms.law/en/chn/legal-updates/china-imposes-strict-bans-on-virtual-currencies), [Baker McKenzie](https://blockchain.bakermckenzie.com/2021/10/04/chinas-central-bank-declares-all-cryptocurrency-transactions-illegal/)).
- **Others:** In November 2021 the Law Library of Congress counted 9 "absolute ban" jurisdictions: Algeria, Bangladesh, China, Egypt, Iraq, Morocco, Nepal, Qatar and Tunisia, plus 42 "implicit bans" ([LoC report](https://tile.loc.gov/storage-services/service/ll/llglrd/2021687419/2021687419.pdf)). This is five years old; some countries have since moved toward licensing. **Recheck each before relying on it.**
- **Sanctioned countries** (e.g. Russia, Iran, North Korea) raise separate sanctions issues; the spec already flags Russian payment rails for the lawyer.

### Where Monero was delisted because of regulation

- **Japan** (2018, FSA pressure; Coincheck delisted XMR) ([Bitcoinist](https://bitcoinist.com/monex-owned-coincheck-confirms-delisting-of-privacy-coins/amp/)).
- **South Korea** (2019–2021; OKEx Korea, Upbit; then the FIU "dark coin" rule) ([CoinDesk](https://www.coindesk.com/okex-korea-drops-5-privacy-coins-citing-fatf-rules/)).
- **Dubai** (2023 VARA prohibition) ([Blockworks](https://blockworks.co/news/privacy-coins-banned-in-dubai)).
- **EEA** (Kraken, 2024; Ireland and Belgium earlier in 2024; UK in 2021) ([Cointelegraph](https://cointelegraph.com/news/kraken-ends-monero-support-european-economic-area)).
- **Binance worldwide** delisted XMR on 20 February 2024 without naming a specific law ([Decrypt](https://decrypt.co/218194/binance-finalizes-monero-delisting?amp=1)).
- **Global standard:** FATF guidance tells regulators to look past "P2P" labels; most self-described P2P platforms have some party that is a VASP ([FATF 2021 guidance](https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-2021.html)) **[exact wording not verified; PDF blocked our fetch]**.

## App stores: what Google Play and Apple mean for X2F

**Google Play.** The "Cryptocurrency Exchanges and Software Wallets" policy says non-custodial wallets are out of scope. X2F is a marketplace, not a wallet, so Google would probably treat it as an exchange **[our reading; the policy does not define "exchange" or mention P2P]**. In listed countries the developer must hold the local licence or remove those countries ([Google Play Help](https://support.google.com/googleplay/android-developer/answer/16329703?hl=en)):

| Country | Google Play requirement for an exchange | Can X2F meet it? |
|---|---|---|
| United States | FinCEN MSB registration **and** state money-transmitter licence, or a bank charter | No, unless X2F gets licensed |
| EU (27) + from July 2026 Iceland, Liechtenstein, Norway | MiCA CASP authorisation | No (and XMR barred from July 2027) |
| United Kingdom | FCA registration | No |
| Canada | FINTRAC MSB registration | Only if X2F registers as an MSB |
| Japan | FSA crypto exchange registration | No |
| South Korea | KoFIU VASP report | No |
| UAE | FSRA, VARA or DFSA licence | No (privacy coins banned) |
| South Africa | FSCA registration | Only if licensed |
| Bahrain, Hong Kong, Indonesia, Israel, Philippines, Thailand | Local licence (CBB, SFC, OJK, CMISA/BoI, BSP, SEC) | No |
| All other countries | May publish, but expected to meet local law; Google may ask for proof | Possible, at risk |

**Apple App Store.** Guideline 3.1.5(iii): apps "may facilitate transactions or transmissions of cryptocurrency on an approved exchange, provided they are offered only in countries or regions where the app has appropriate licensing and permissions to provide a cryptocurrency exchange." Guideline 5.1.1(ix) says crypto exchange apps must come from a legal entity, not an individual. Wallets (3.1.5(i)) need an organisation account ([Apple guidelines](https://developer.apple.com/app-store/review/guidelines/)). Apple applies this country by country. Unlike Google, Apple has no list; reviewers can ask for proof of a licence anywhere. A lawyer's opinion that no licence is needed in country X may help, but is not guaranteed to pass review. Japan and Korea show regulators can also make Apple and Google pull apps ([The Block](https://www.theblock.co/post/339501/japan-apple-google-block-crypto-apps), [Decrypt](https://decrypt.co/314786/south-korea-blocks-apps-crypto-exchanges-apple-google-stores)).

**Practical effect.** Store apps are realistic only in countries where X2F is licensed or where counsel is confident no licence is needed, and only after store review. The web app (plus .onion) is not subject to store rules, which supports the spec's "web first" plan. Note: regulators can also block websites (India, Nigeria, China do).

## Questions to ask the lawyer

1. Under FinCEN's 2019 guidance, is X2F a "forum" (§5.1) or an intermediary? Does running the escrow and deciding disputes push it over the line?
2. Does holding one of three multisig keys, with auto-signing only to the seller's refund address, keep X2F outside "total independent control" (§4.2.2)? Does refusing to sign count as "control" under state law ("prevent indefinitely")?
3. Does taking the 1% fee as an output of the escrow transaction mean X2F "accepts" value? Would charging the fee separately (e.g. a payment by the ad poster from their own wallet) be safer?
4. After Samourai and Storm, how real is US criminal risk for a non-custodial operator? Does DOJ's August 2025 statement help a company that runs servers and moderators?
5. Which country should the company be based in, and which should it geoblock? Is any EU country workable before 10 July 2027, and none after?
6. Under MiCA, is X2F "operation of a trading platform" or "reception and transmission of orders"? Is there any route to the "fully decentralised" carve-out (recital 22)?
7. Under AMLR Article 79 and recital 160, is a one-of-three moderator key "access to or control over" a wallet? Would X2F be a CASP "keeping an account" for XMR?
8. In the UK, is X2F "making arrangements with a view to the exchange" under MLR reg. 14A? Would geoblocking UK users and not marketing there be enough, given the LocalCoinSwap warning?
9. What does "targeting" mean in practice (language, currency, payment methods like Zelle or SEPA, domain)? Which X2F features make it look like it targets a given country?
10. Does no-KYC plus no IP logging create extra criminal exposure (e.g. "wilful blindness" for money laundering), separate from licensing? What minimum controls would reduce that risk without KYC?
11. Are moderators deciding disputes a regulated activity anywhere (e.g. escrow agent, arbitration)? Does paying moderators create employment or agency exposure in their countries?
12. Personal liability: can the owner and developers be charged personally (as in Samourai and Tornado Cash)? What corporate structure and insurance help?
13. Do the Terms of Service need country exclusions, a sanctions clause, and an "XMR may be restricted where you live" warning? Who is responsible if a user trades from a banned country?
14. For the app stores: would you write an opinion letter that X2F is not an exchange in specific countries? Which countries could we safely target on Google Play and Apple?
15. How should we handle a lawful request for data from a foreign government, given we hold little data?

## Sources

Primary sources (opened directly):
- FinCEN, FIN-2019-G001, Application of FinCEN's Regulations to Certain Business Models Involving CVCs (May 2019): https://www.fincen.gov/sites/default/files/2019-05/FinCEN%20Guidance%20CVC%20FINAL%20508.pdf
- DOJ SDNY, Samourai founders sentenced: https://www.justice.gov/usao-sdny/pr/founders-samourai-wallet-cryptocurrency-mixing-service-sentenced-five-and-four-years
- Regulation (EU) 2023/1114 (MiCA): https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32023R1114
- Regulation (EU) 2024/1624 (AMLR): https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1624
- UK MLR 2017 reg. 14A: https://www.legislation.gov.uk/uksi/2017/692/regulation/14A
- HM Treasury, 5MLD consultation response (Jan 2020): https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/860491/5MLD_Consultation_Response.pdf
- FCA warning, LocalCoinSwap: https://www.fca.org.uk/news/warnings/localcoinswap-localcoinswapcom
- FCA press release, 17 Sept 2026: https://www.fca.org.uk/news/press-releases/fca-and-partners-continues-crackdown-illegal-crypto-trading
- FCA PS26/18: https://www.fca.org.uk/publications/policy-statements/ps26-18-cryptoasset-perimeter-guidance
- FINTRAC MSB page: https://fintrac-canafe.canada.ca/msb-esm/msb-eng
- FINTRAC VC indicators: https://fintrac-canafe.canada.ca/guidance-directives/transaction-operation/indicators-indicateurs/vc_mltf-eng
- Google Play, Cryptocurrency Exchanges and Software Wallets policy: https://support.google.com/googleplay/android-developer/answer/16329703?hl=en
- Google Play policy announcement, 10 July 2025: https://support.google.com/googleplay/android-developer/answer/16296680?hl=en-GB
- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- US Law Library of Congress, Regulation of Cryptocurrency Around the World (Nov 2021): https://tile.loc.gov/storage-services/service/ll/llglrd/2021687419/2021687419.pdf

Primary sources (read via search results only):
- MAS, DTSP regime: https://www.mas.gov.sg/news/media-releases/2025/mas-clarifies-regulatory-regime-for-digital-token-service-providers
- Japan Payment Services Act (official translation): https://www.japaneselawtranslation.go.jp/en/laws/view/3965/en
- AUSTRAC, VASP reform: https://www.austrac.gov.au/about-us/amlctf-reform/reforms-guidance/before-you-start/new-industries-and-services-be-regulated-reform/virtual-asset-services-reform
- AUSTRAC, transitional rules 2026: https://www.austrac.gov.au/about-us/legislation/updates-legislation/amlctf-transitional-rules-2026
- VARA Rulebook, Prohibited Virtual Assets: https://rulebooks.vara.ae/rulebook/b-prohibited-virtual-assets
- VARA licensed activities: https://www.vara.ae/en/licenses-and-register/licensed-activities/
- BCB press note on virtual asset rules: https://www.bcb.gov.br/en/pressdetail/2639/nota
- FINMA, Guidance 02/2019: https://www.finma.ch/en/news/2019/08/20190826-mm-kryptogwg/
- PIB / FIU-IND releases: https://www.pib.gov.in/PressReleasePage.aspx?PRID=1991372&reg=48&lang=2 ; https://www.pib.gov.in/PressReleasePage.aspx?PRID=2173758&reg=48&lang=2 ; https://www.pib.gov.in/PressReleasePage.aspx?PRID=2308131&reg=48&lang=2
- California DFPI, DFAL FAQ: https://dfpi.ca.gov/regulated-industries/digital-financial-assets/digital-financial-assets-law-frequently-asked-questions/
- CSBS Model Money Transmission Modernization Act: https://www.csbs.org/sites/default/files/2023-02/CSBS%20Money%20Transmission%20Modernization%20Act.pdf
- FATF, Updated Guidance on VAs and VASPs (2021): https://www.fatf-gafi.org/en/publications/Fatfrecommendations/Guidance-rba-virtual-assets-2021.html

Secondary sources (news and law firms):
- The Block, Storm retrial: https://theblock.co/news/regulation/2026-08-26-tornado-cash-roman-storm-retrial-april-2027-412761
- The Block, DOJ "writing code" statement: https://www.theblock.co/post/367858/writing-code-without-ill-intent-is-not-a-crime-says-us-doj-official-following-tornado-cash-verdict
- Willkie, Tornado Cash sanctions lifted: https://complianceconcourse.willkie.com/articles/united-states-removes-economic-sanctions-against-tornado-cash/
- ABA Banking Journal, CLARITY Act: https://bankingjournal.aba.com/2026/08/senate-adjourns-with-no-vote-on-clarity-act/
- DeFi Rate, CLARITY Act cloture: https://defirate.com/clarity-act-fact-sheet/
- Charltons Quantum, Paxful sentence: https://charltonsquantum.com/us-doj-sentences-paxful-holdings-inc-to-usd-4-million-criminal-penalty-for-travel-act-and-bank-secrecy-act-violations/
- Regulation Tomorrow, UK final crypto legislation: https://www.regulationtomorrow.com/2025/12/hmt-announces-final-cryptoasset-regulatory-regime-legislation/
- Cointelegraph, Kraken EEA XMR delisting: https://cointelegraph.com/news/kraken-ends-monero-support-european-economic-area
- PwC, Swiss DLT rules: https://pwc.ch/en/insights/regulation/swiss-dlt-new-regulations.html
- Mondaq, FINMA 02/2019 implications: https://www.mondaq.com/fin-tech/843804/practical-implications-of-the-new-finma-guidance-on-payments-on-the-blockchain
- Clyde & Co, Singapore PSA expansion: https://www.clydeco.com/en/insights/2024/04/singapore-payment-services-act-to-now-cover-token
- The Block, Japan FIEA bill: https://www.theblock.co/post/408361/japan-passes-key-bill
- The Block, Japan app removals: https://www.theblock.co/post/339501/japan-apple-google-block-crypto-apps
- Crowdfund Insider, Japan privacy coins 2018: https://www.crowdfundinsider.com/2018/05/132808-japan-regulators-urging-crypto-exchanges-to-exclude-anonymous-altcoins/
- Bitcoinist, Coincheck delisting: https://bitcoinist.com/monex-owned-coincheck-confirms-delisting-of-privacy-coins/amp/
- Cointelegraph, Korea privacy coin ban: https://cointelegraph.com/news/south-korean-financial-watchdog-to-ban-privacy-coins
- CoinDesk, OKEx Korea delisting: https://www.coindesk.com/okex-korea-drops-5-privacy-coins-citing-fatf-rules/
- Decrypt, Korea app blocks: https://decrypt.co/314786/south-korea-blocks-apps-crypto-exchanges-apple-google-stores
- Cointelegraph, Google Play Korea blocks: https://cointelegraph.com/news/google-play-blocks-17-unregistered-crypto-exchanges-south-korea
- Bird & Bird, Dubai regime: https://twobirds.com/en/insights/2023/uae/the-new-dubai-virtual-asset-regime
- Blockworks, Dubai privacy coins: https://blockworks.co/news/privacy-coins-banned-in-dubai
- Blog del Contador, Argentina RG 994: https://blogdelcontador.com.ar/cnv-oficializa-regulacion-cripto-en-argentina-que-es-y-para-que-servira-el-registro-proveedores-de-servicios-de-activos-virtuales-psav/
- Microjuris, Argentina PSAV rules: https://aldiaargentina.microjuris.com/2025/09/24/legislacion-cnv-nueva-reglamentacion-para-proveedores-de-servicios-de-activos-virtuales-psav/
- CryptoSlate, Mexico LFPIORPI: https://cryptoslate.com/crypto-laws/mexico-lfpiorpi-article-17-xvi-virtual-asset-aml-regime/
- Mondaq, Nigeria ISA 2025: https://webiis10.mondaq.com/nigeria/fin-tech/1623238/what-the-investment-and-securities-act-2025-means-for-digital-and-virtual-assets-in-nigeria
- Cointelegraph, Binance drops naira: https://cointelegraph.com/news/binance-drops-naira-government-scrutiny
- BusinessDay, SEC to delist naira from P2P: https://businessday.ng/technology/article/crypto-crackdown-sec-to-delist-naira-from-p2p-platforms/
- Bizmag, South Africa CASPs: https://bizmag.co.za/crypto-asset-service-providers-the-travel-rule-and-regulatory-reporting/
- Moonstone, Directive 9: https://www.moonstone.co.za/no-exemptions-all-casps-must-adopt-travel-rule-directive/
- Mondaq, Turkey Law 7518: https://www.mondaq.com/turkey/fin-tech/1496058/new-legislative-changes-regarding-crypto-asset-services-in-turkey
- CryptoSlate, Turkey CMB communiqué: https://cryptoslate.com/crypto-laws/turkey-cmb-communique-iii-35-b-1-crypto-asset-service-provider-rules/
- Cointelegraph, El Salvador bitcoin law amendment: https://cointelegraph.com/news/el-salvador-bitcoin-status-btc-law-amendment
- CriptoNoticias, El Salvador registry: https://www.criptonoticias.com/negocios/apenas-11-empresas-bitcoin-registro-elsalvador-operativas
- Global Law Experts, El Salvador licences: https://globallawexperts.com/bitcoin-service-provider-licence-el-salvador/
- CMS, China ban: https://cms.law/en/chn/legal-updates/china-imposes-strict-bans-on-virtual-currencies
- Baker McKenzie, China ban: https://blockchain.bakermckenzie.com/2021/10/04/chinas-central-bank-declares-all-cryptocurrency-transactions-illegal/
- Decrypt, Binance XMR delisting: https://decrypt.co/218194/binance-finalizes-monero-delisting?amp=1

**Not researched or not verified:** New York BitLicense details; Canadian provincial securities rules; Brazil's reach over offshore platforms; Turkey's treatment of foreign platforms and privacy coins; Japan's 2025 intermediary licence details and the FIEA start date; current status of the 2021 ban list.
