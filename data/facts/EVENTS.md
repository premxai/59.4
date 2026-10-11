# EVENTS.md: ERCOT grid stress events, operating parameters, and costs

Fact base for the "4:37" ERCOT simulator. Compiled 2026-10-10 from primary reports (FERC/NERC, ERCOT, UT Austin, PUCT/Dallas Fed) plus a few press sources where no primary source was available.

## Labeling rule (test-leakage guard)

- **[CALIBRATION-SAFE]**: the fact was published, or knowable, before 2021-01-01. You may use it to build and calibrate the simulator.
- **[TEST-ONLY]**: the fact comes from 2021 or later, or the only source we have for it is dated 2021 or later. Use it only for evaluation and the "what actually happened" comparison.
- **Strict rule:** a pre-2021 rule or condition that we could source only from a 2021+ document is tagged **[TEST-ONLY]** and marked "(describes pre-2021 state)". Before using it for calibration, find a pre-2021 source for it.
- MW values are nameplate unless a row says otherwise. ERCOT outage MW can be nameplate, seasonal, or "expected" capacity depending on the source, and the bases do not compare directly.
- Times are Central (Texas local) unless a row says otherwise.

### Source keys used below (every link points to the source used)

| Key | Document | Date |
|---|---|---|
| FERC-2011 | [FERC/NERC staff report, Southwest Cold Weather Event of Feb 1-5, 2011](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) | Aug 2011 |
| FERC-NERC-2021 | [FERC-NERC-Regional Entity staff report, The February 2021 Cold Weather Outages in Texas and the South Central US](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) | Nov 2021 |
| UT-2021 | [UT Austin Energy Institute, The Timeline and Events of the February 2021 Texas Electric Grid Blackouts](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) | Jul 2021 |
| ERCOT-Board-0224 | [ERCOT Urgent Board presentation (revised), Feb 24, 2021](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf) | Feb 2021 |
| ERCOT-Causes-0427 | [ERCOT, Update to Preliminary Report on Causes of Generator Outages and Derates](https://www.ercot.com/files/docs/2021/04/28/ERCOT_Winter_Storm_Generator_Outages_By_Cause_Updated_Report_4.27.21.pdf) | Apr 2021 |
| ERCOT-EEA-2014 | [ERCOT Final Report, January 6, 2014 EEA](https://www.ercot.com/files/docs/2014/03/07/ros_jan_6_eea_report.pdf) | Mar 2014 |
| ERCOT-Inertia-2018 | [ERCOT, Inertia: Basic Concepts and Impacts on the ERCOT Grid](https://www.ercot.com/files/docs/2018/04/04/Inertia_Basic_Concepts_Impacts_On_ERCOT_v0.pdf) | Apr 2018 |
| NOGRR139 | [ERCOT NOGRR 139 TAC Report (generator under/over-frequency relay settings)](https://www.ercot.com/files/docs/2015/03/27/139NOGRR_10_TAC_Report_032615.doc) | Mar 2015 |
| POB754 | [ERCOT Power Operations Bulletin #754 (EEA desk procedure)](https://www.ercot.com/files/pobs/2016/07/15/Power_Operations_Bulletin_754.doc) | Jul 2016 |
| EEA-2019 | [ERCOT, ERCOT's use of Energy Emergency Alerts (one-pager)](https://www.ercot.com/files/docs/2019/09/17/EEA_OnePager_FINAL_June2019.pdf) | Jun 2019 |
| EEA-2021 | [ERCOT, 2021 Energy Emergency Alert Overview](https://www.ercot.com/files/docs/2021/06/11/2021_EEA_Overview_Final.pdf) | May/Jun 2021 |
| AS-2020 | [ERCOT 2020 Methodologies for Determining Minimum Ancillary Service Requirements](https://www.ercot.com/files/docs/2019/12/03/8_2020_ERCOT_Methodologies_for_Determining_Minimum_Ancillary_Service_Requirements.pdf) | Dec 2019 |
| SUM2019 | [ERCOT Summer 2019 Operational and Market Review](https://www.ercot.com/files/docs/2019/10/01/5.1_Summer_2019_Operational_and_Market_Review.pdf) | Oct 2019 |
| FACT-2020 | [ERCOT Fact Sheet, November 2020](https://www.ercot.com/files/docs/2020/11/10/ERCOT_Fact_Sheet_11.10.20.pdf) | Nov 2020 |
| CDR-2020 | [ERCOT Capacity, Demand and Reserves Report, Dec 2020](https://www.ercot.com/files/docs/2020/12/16/CapacityDemandandReservesReport_Dec2020.pdf) | Dec 2020 |
| SARA-W2021 | [ERCOT SARA, Final Winter 2020/2021](https://www.ercot.com/files/docs/2020/11/05/SARA-FinalWinter2020-2021.pdf) (numbers read via UT-2021 and FERC-NERC-2021) | Nov 5, 2020 |
| ELLIOTT-PUB | [ERCOT December 2022 Cold Weather Operations Public Report](https://www.ercot.com/files/docs/2023/03/27/December-2022-Cold-Weather-Operations-Public-Report.pdf) | Mar 2023 |
| ELLIOTT-BRD | [ERCOT Board, Review of Winter Storm Elliott](https://www.ercot.com/files/docs/2023/02/21/7-Review-of-Winter-Storm-Elliott.pdf) | Feb 2023 |
| SYSOPS-2023-10 | [ERCOT Board, System Operations Update (Sept 6, 2023 EEA)](https://www.ercot.com/files/docs/2023/10/09/7.2%20System%20Operations%20Update.pdf) | Oct 2023 |
| DALLASFED | [Dallas Fed, Cost of Texas' 2021 Deep Freeze Justifies Weatherization](https://www.dallasfed.org/research/economics/2021/0415) | Apr 2021 |

---

## 1. February 1-5, 2011 Southwest cold weather event (ERCOT portion)

All rows in this section are **[CALIBRATION-SAFE]** (FERC-2011, published Aug 2011, unless noted).

### 1.1 Weather

| Fact | Value | Tag | Source |
|---|---|---|---|
| Dallas lows over the event | 13-19 °F (narrative also says 14-19 °F) | [CALIBRATION-SAFE] | [FERC-2011 pp.1, 50](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Dallas minimum temperature / wind chill, Feb 1-2 | 13 °F / -6 °F (Austin wind chill 6 °F) | [CALIBRATION-SAFE] | [FERC-2011 pp.51, 178](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Midland lows | 6-12 °F | [CALIBRATION-SAFE] | [FERC-2011 p.50](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Dallas winds, Feb 1 | up to 25 mph, gusts 20-40 mph | [CALIBRATION-SAFE] | [FERC-2011 p.50](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Sub-freezing duration | many cities below freezing ~4 days; Feb 2 one of the coldest days in 25 years | [CALIBRATION-SAFE] | [FERC-2011 pp.7, 50](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Deviation from average daily temperature | 17-36 °F below average | [CALIBRATION-SAFE] (NOAA data via 2021 table) | [FERC-NERC-2021 Fig.18](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Consecutive hours at or below freezing | DFW 101 h, Austin 69 h, Houston 34 h | [CALIBRATION-SAFE] (observational 2011 data; read from 2021 ERCOT slide) | [ERCOT-Board-0224 slide 18](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf) |

### 1.2 System state going in

| Fact | Value | Tag | Source |
|---|---|---|---|
| Forecast 2010/11 winter peak (50/50) | 47,824 MW | [CALIBRATION-SAFE] | [FERC-2011 pp.52-53](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Projected generation + imports (NERC WRA) | 72,881 MW (72,500 generation + 381 net firm imports) | [CALIBRATION-SAFE] | [FERC-2011 p.52 fn.81](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Planning reserve margin | 57% (NERC reference margin for ERCOT: 13%) | [CALIBRATION-SAFE] | [FERC-2011 p.53](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Load forecast for Feb 1 / Feb 2 | 52,673 / 57,436 MW (manual +4,000 MW wind adjustment) | [CALIBRATION-SAFE] | [FERC-2011 pp.54, 58](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Scheduled outages | 11,566 MW (Feb 1); 12,413 MW (Feb 2) | [CALIBRATION-SAFE] | [FERC-2011 pp.54, 79](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Responsive reserves available, first day | >3,100 MW vs 2,300 MW minimum | [CALIBRATION-SAFE] | [FERC-2011 p.7](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Non-spinning reserve requirement, Feb 2011 | 2,000 MW | [CALIBRATION-SAFE] | [FERC-2011 p.55](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Load Resources (auto-trip on under-frequency) | 1,062 MW as of Feb 2 | [CALIBRATION-SAFE] | [FERC-2011 p.53](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Emergency Interruptible Load Service (EILS) | 331 MW contracted as of Feb 2 | [CALIBRATION-SAFE] | [FERC-2011 p.53](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Total ERCOT fleet at 8 AM Feb 2 | ~79,700 MW (79,658 MW with wind adjusted to 57% of 9,321 MW nameplate) | [CALIBRATION-SAFE] | [FERC-2011 pp.79, 83](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |

### 1.3 Generation outages

| Fact | Value | Tag | Source |
|---|---|---|---|
| Units with outage/derate/failure to start, Feb 1-4 | 210 units | [CALIBRATION-SAFE] | [FERC-2011 p.1](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Units failed or derated, Feb 1-2 (gross cumulative) | 193 units, 29,729 MW | [CALIBRATION-SAFE] | [FERC-2011 pp.7, 78](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Texas RE count | 225 units; max 14,855 MW unplanned unavailable | [CALIBRATION-SAFE] (TRE 2011 report, quoted in UT-2021) | [UT-2021 p.72](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Weather-related forced outages by midnight Feb 1 | 6,022 MW | [CALIBRATION-SAFE] | [FERC-2011 p.75](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| **Peak simultaneous net forced outage** (6:12 AM Feb 2) | **14,702 MW** (+12,413 MW scheduled = 27,115 MW, ~1/3 of fleet) | [CALIBRATION-SAFE] | [FERC-2011 p.79](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Net capacity reduction as % of peak load | 26% | [CALIBRATION-SAFE] | [FERC-2011 p.178](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Units lost during the load shed (5:45-6:30 AM) | 18 units, 1,643 MW lost (12 units, 774 MW returned) | [CALIBRATION-SAFE] | [FERC-2011 p.87](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Cause split by unit count, Feb 1-5 | direct weather 52%, non-weather 40%, fuel supply 9% | [CALIBRATION-SAFE] | [FERC-2011 p.144](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Weather-related, Feb 1-5 (total) | 130 units, 22,805 MW | [CALIBRATION-SAFE] | [FERC-2011 p.144](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| - frozen sensing lines | 68 units, 15,255 MW (drum-level lines 43 units / 9,438 MW; other lines 25 / 5,817) | [CALIBRATION-SAFE] | [FERC-2011 p.144](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| - frozen equipment (general) | 13 units, 2,942 MW | [CALIBRATION-SAFE] | same |
| - frozen water lines | 12 units, 1,072 MW | [CALIBRATION-SAFE] | same |
| - frozen valves | 8 units, 1,501 MW | [CALIBRATION-SAFE] | same |
| - wind blade icing | 10 units, 709 MW | [CALIBRATION-SAFE] | same |
| - wind low-temperature limits | 17 units, 1,237 MW | [CALIBRATION-SAFE] | same |
| - transmission loss | 2 units, 89 MW | [CALIBRATION-SAFE] | same |
| Non-weather, Feb 1-5 (total) | 100 units, 14,386 MW (mechanical 37/7,588; control systems 28/3,624; fuel switching 12/909; operator error 9/980; emissions 3/358; misc 11/927) | [CALIBRATION-SAFE] | [FERC-2011 p.150](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Typical non-storm ERCOT forced outages (2010) | 900-6,300 MW/day, average 3,200 MW/day | [CALIBRATION-SAFE] | [FERC-2011 p.150](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Fuel-supply (gas curtailment/quality) outages, Feb 1-5 | 1,282 MW total | [CALIBRATION-SAFE] | [FERC-2011 p.153](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| 1989-style category split, 2011 | frozen instrumentation 61 units / 13,924 MW; other cold-related 54 / 6,365; non-weather 63 / 7,905; gas curtailment 15 / 1,534; weather share of gross MW 68%; frozen-instrument share 47% | [CALIBRATION-SAFE] | [FERC-2011 p.178](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Failure rate by unit type (by unit count) | combined cycle 48% failed (35% of fleet units); wind 16% (15%); simple cycle 21% (20%); gas-steam 13% (13%); coal 7% (7%); nuclear 0 | [CALIBRATION-SAFE] | [FERC-2011 p.143](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Unit age | no strong correlation: pre-1981 units 19% of failures vs 22% of fleet; 2001-2010 units 55% vs 48% | [CALIBRATION-SAFE] | [FERC-2011 p.143](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Fuel switching | ~90 dual-fuel units; 20 tried to switch, 15 succeeded | [CALIBRATION-SAFE] | [FERC-2011 pp.151-152](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Black start units unavailable | 10 of 21 (687 of 1,150 MW) | [CALIBRATION-SAFE] | [FERC-2011 p.86](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Southwest-wide share of failures by MWh | 67% direct weather + at least 12% indirect (gas curtailment, fuel switching) | [CALIBRATION-SAFE] | [FERC-2011 pp.8-9](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |

### 1.4 Load shed, reserves and frequency (Feb 2, 2011)

| Fact | Value | Tag | Source |
|---|---|---|---|
| Reserves < 3,000 MW | by 3:00 AM | [CALIBRATION-SAFE] | [FERC-2011 p.75](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Non-spin deployed | 4:30 AM, 1,840 MW; 10 units (669 MW) failed to respond | [CALIBRATION-SAFE] | [FERC-2011 p.76](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| EEA 2A | 5:20 AM (reserves < 1,750 MW); 888.5 MW of Load Resources deployed, 881.7 MW responded | [CALIBRATION-SAFE] | [FERC-2011 p.77](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| EEA 3, first shed order | 5:43 AM, 1,000 MW (+384.2 MW EILS) | [CALIBRATION-SAFE] | [FERC-2011 pp.78, 87](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Further shed orders | 6:04 AM +1,000 MW; 6:23 AM +2,000 MW; **4,000 MW total directed** | [CALIBRATION-SAFE] | [FERC-2011 p.87](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| **Minimum frequency** | **59.576 Hz at 6:05 AM** | [CALIBRATION-SAFE] | [FERC-2011 p.87](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Minimum responsive reserves | 447 MW at 6:25 AM | [CALIBRATION-SAFE] | [FERC-2011 p.87](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Time with reserves below the N-1 level (1,354 MW) | 134 min total in 6 intervals; longest 73 min | [CALIBRATION-SAFE] | [FERC-2011 p.85](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Actual load shed | max simultaneous 4,947.9 MW at 8:02 AM; sum of TSP non-coincident peaks 5,411.6 MW | [CALIBRATION-SAFE] | [FERC-2011 p.89](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Load shed as % of peak load | ~4,900 MW = 8.7% | [CALIBRATION-SAFE] | [FERC-2011 p.178](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Restoration | began 7:57 AM in 500 MW blocks; fully restored 1:07 PM | [CALIBRATION-SAFE] | [FERC-2011 pp.86-88](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Duration of firm load shedding | 7 h 24 min | [CALIBRATION-SAFE] | [FERC-2011 p.178](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Customers affected | 3.2 million (Feb 2); +180,000 (300 MW) in the Rio Grande Valley on Feb 3 | [CALIBRATION-SAFE] | [FERC-2011 pp.1, 52](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Demand absent load shed (IMM estimate) | ~59,000 MW just after 7:00 AM | [CALIBRATION-SAFE] | [FERC-2011 p.77](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Peak system load (2011 comparison table) | 56,334 MW; ERCOT winter record 56,480 MW at 7:15 PM Feb 2 | [CALIBRATION-SAFE] | [FERC-2011 pp.88, 178](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Feb 10, 2011 winter peak (no load shed) | 57,915 MW at 7:15 AM (FERC); ERCOT settled hourly value 57,265 MW | [CALIBRATION-SAFE] | [FERC-2011 p.99 fn.158](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf); [ERCOT release 2011-02-10](https://www.ercot.com/news/release/2011-02-10-ercot-breaks-electricity) |
| Automatic UFLS during event | none reported | [CALIBRATION-SAFE] | [FERC-2011 p.90](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Spot price | hit $3,000/MWh cap on Feb 2 | [CALIBRATION-SAFE] | [FERC-2011 p.8](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Manual load shed rotation targets | 15 min to 30-45 min per block | [CALIBRATION-SAFE] | [FERC-2011 p.90](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |

### 1.5 Natural gas supply (2011)

| Fact | Value | Tag | Source |
|---|---|---|---|
| Southwest production lost, Feb 1-5 | ~14.8 Bcf | [CALIBRATION-SAFE] | [FERC-2011 p.9](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| US dry gas production drop | 5.55 Bcf/d (-9.4% from 59.22 Bcf/d on Jan 31); low point Feb 4 | [CALIBRATION-SAFE] | [FERC-2011 p.113](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Texas + New Mexico basins | 4.36 Bcf/d drop (79% of the US decline; -21% regionally) | [CALIBRATION-SAFE] | [FERC-2011 p.114](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Basin declines (Bcf/d) | Permian 1.31; San Juan 0.43; Fort Worth 1.63; East Texas 0.72; Gulf Coast 0.65 | [CALIBRATION-SAFE] | [FERC-2011 p.114](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Causes of production loss | freeze-offs (water freezing at the wellhead), icy roads, rolling blackouts | [CALIBRATION-SAFE] | [FERC-2011 p.9](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Share of production outages caused by electric blackouts | Permian 29%; Fort Worth 27% | [CALIBRATION-SAFE] | [FERC-2011 p.9](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Gas customers curtailed | >50,000 (NM, AZ, TX incl. El Paso) | [CALIBRATION-SAFE] | [FERC-2011 pp.9-10](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |

### 1.6 Recommendations (2011)

| Fact | Value | Tag | Source |
|---|---|---|---|
| Number of recommendations | 26 electric + 6 natural gas = 32 | [CALIBRATION-SAFE] | [FERC-2011 pp.196-217](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Key electric winterization recommendations | treat winter prep like summer prep (#1); winter sensitivity studies (#2); let ERCOT raise the 2,300 MW RRS in extreme cold and order pre-warming (#5); verify fuel switching (#6); black start winter readiness (#7); accurate ambient design temperatures (#8); unit output forecasts for severe weather (#9); state winterization-plan requirements (#11); design new plants for the lowest recorded local temperature (#12); assess existing design temperatures (#13); maintain freeze protection, heat tracing and insulation (#14-16); wind breaks and enclosures (#17); annual winter training (#18); pre-stage supplies and staff (#19); critical-load review for gas facilities (#25); load shed drills (#26) | [CALIBRATION-SAFE] | [FERC-2011 pp.197-212](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Gas recommendations | consider minimum winterization for production (#1); consider exempting critical gas facilities from rolling blackouts (#2); LDC curtailment and priority (#3-6) | [CALIBRATION-SAFE] | [FERC-2011 pp.214-217](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Repeat failures from 1989 | of 56+ units that failed in 1989, 43 (13,606 MW) still operating in 2011; 26 of those (5,654 MW) failed again | [CALIBRATION-SAFE] | [FERC-2011 p.178](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |

---

## 2. Other pre-2021 events useful for calibration

### 2.1 December 21-23, 1989 freeze

| Fact | Value | Tag | Source |
|---|---|---|---|
| Minimum temperatures | Houston 7 °F, Dallas -1 °F, Abilene -7 °F; wind chill down to -35 °F (the comparison table lists Dallas wind chill -12 °F) | [CALIBRATION-SAFE] | [FERC-2011 pp.172, 174, 178](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Peak demand | 38,300 MW at 10:00 AM Dec 22 (+11% vs prior winter peak; +18% vs forecast; 93% of summer peak); online capacity 39,800 MW | [CALIBRATION-SAFE] | [FERC-2011 pp.172, 174](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Weather outages | ~3,000 MW by midnight Dec 22, +4,700 MW from midnight to 7 AM Dec 23; 1,500 MW derate from gas-to-oil switching; 7 units (1,275 MW) tripped almost at once at 10:20 AM Dec 23 | [CALIBRATION-SAFE] | [FERC-2011 p.174](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Gross capacity lost | 56+ units, 16,805 MW (frozen instrumentation 34 units/11,623 MW; fish clogging intakes 6/1,385; other cold 9/1,051; non-weather 7/1,246; gas curtailment derate 1,500 MW) | [CALIBRATION-SAFE] | [FERC-2011 p.175](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| By fuel | coal 8 units/4,669 MW; gas 29/3,881; distillate 1/257; dual gas-oil 15/4,418; dual coal-gas 1/670; nuclear 1/1,250; pet coke 1/160 | [CALIBRATION-SAFE] | [FERC-2011 p.176](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Net capacity reduction | 11,809 MW (31% of peak load) | [CALIBRATION-SAFE] | [FERC-2011 p.178](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Frequency | <59.95 Hz at 8:30 AM Dec 22; 59.79-59.92 Hz from 5:36 AM Dec 23; dropped to 59.65 Hz at ~10:20 AM Dec 23 | [CALIBRATION-SAFE] | [FERC-2011 pp.173-174](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Firm load shed | HL&P 1,000 MW, LCRA 60 MW, CPS 150 MW, then 500 MW system-wide; PUCT total 1,710 MW (4.5% of peak) | [CALIBRATION-SAFE] | [FERC-2011 pp.174-175, 178](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Duration of firm load shedding | 5 h 47 min | [CALIBRATION-SAFE] | [FERC-2011 p.178](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Utilities' estimated cost of corrective actions | < $3 million (PUCT 1990 report) | [CALIBRATION-SAFE] (1990 PUCT finding, read via UT-2021) | [UT-2021 p.71](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| PUCT 1990 recommendations | design for extremes, annual fall readiness review, fix freeze protection, maintain insulation and heat tracing, training and drills, review of design temperatures in plant permits; all voluntary | [CALIBRATION-SAFE] | [FERC-2011 pp.176-177](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| ERCOT size, 1989 vs 2011 | 323 units / ~54,000 MW in 1989; 550 units / ~84,400 MW nameplate in 2011 | [CALIBRATION-SAFE] | [FERC-2011 p.179 fn.234](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |

### 2.2 Other ERCOT events before 2021

| Event | Facts | Tag | Source |
|---|---|---|---|
| Feb 24-25, 2003 cold | demand 42,029 MW (forecast exceeded by 4,218 MW, 11%); gas curtailment tripped 3 units (745 MW) at 9:08 AM; frequency 59.81 Hz; EECP Step 1 (reserves < 2,300 MW) for ~7.5 h; 5,500 MW lost to gas curtailment, 3,200 MW recovered on oil, net loss 2,300 MW; prices $990/MWh | [CALIBRATION-SAFE] | [FERC-2011 pp.170-171](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| May 2003 (two nuclear units trip) | automatic UFLS shed 1,549 MW of firm load; restored in 3 h 30 min | [CALIBRATION-SAFE] | [FERC-2011 p.173 fn.229](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| April 17, 2006 heat + 4 unit losses | 1,000 MW rotating outages; restored in 1 h 45 min | [CALIBRATION-SAFE] | [FERC-2011 p.173 fn.229](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Jan 6, 2014 polar vortex | 9,355 MW lost before EEA (3,541 MW weather-related); 2,468 MW planned + 2,938 MW forced going in; EEA1 6:52 AM, EEA2 7:01 AM, exit EEA2 7:51, normal 9:12; Load Resources 1,082 MW, ERS-30 112 MW, ERS-10 508 MW, non-spin 187 MW; minimum PRC 1,344 MW at 7:09; no firm load shed; forecast peak 54,442 MW | [CALIBRATION-SAFE] | [ERCOT-EEA-2014 pp.5-7](https://www.ercot.com/files/docs/2014/03/07/ros_jan_6_eea_report.pdf) |
| Jan 17, 2018 cold snap (winter record) | ERCOT winter peak 65,915 MW, 7-8 AM (ERCOT's later value; preliminary 65,750 MW) | [CALIBRATION-SAFE] (Jan 2018 record; 65,915 as later cited in SARA Nov 2020) | [UT-2021 p.15 citing SARA-W2021](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf); [ERCOT CEO update Feb 2018](https://www.ercot.com/files/docs/2018/02/15/8.1_REVISED_CEO_Update.pdf) |
| Jan 2018, South Central US (MISO/SPP mostly) | 15,800 MW of generation outages; voluntary load management, no firm shed; gas units at least 70% of unplanned outages (ERCOT-specific outage MW not found) | [CALIBRATION-SAFE] (July 2019 FERC-NERC report) | [FERC-NERC 2018 report](https://www.ferc.gov/sites/default/files/2020-07/SouthCentralUnitedStatesColdWeatherBulkElectricSystemEventofJanuary17-2018.pdf) |
| Aug 13 and 15, 2019 heat | two EEA1 events (PRC 2,156 MW at 15:10 on Aug 13, 35 min below 2,300 MW; 2,245 MW at 15:05 on Aug 15); ERS deployment avoided EEA2; record 74,666 MW Aug 12, 2019 (later settled 74,820 MW) | [CALIBRATION-SAFE] | [SUM2019](https://www.ercot.com/files/docs/2019/10/01/5.1_Summer_2019_Operational_and_Market_Review.pdf); [FACT-2020](https://www.ercot.com/files/docs/2020/11/10/ERCOT_Fact_Sheet_11.10.20.pdf) |
| System-wide rotating outages before 2021 | three times: Dec 1989, Apr 17, 2006, Feb 2, 2011 | [CALIBRATION-SAFE] | [EEA-2019](https://www.ercot.com/files/docs/2019/09/17/EEA_OnePager_FINAL_June2019.pdf) |
| Winter 2020/21 pre-season outlook (SARA) | forecast peak 57,699 MW; total resources 82,513 MW minus 4,074 MW maintenance and 4,542 MW forced outages = ~74,000 MW; reserves 16,198 MW in the base case | [CALIBRATION-SAFE] | [UT-2021 pp.15-16](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf); [SARA-W2021](https://www.ercot.com/files/docs/2020/11/05/SARA-FinalWinter2020-2021.pdf) |
| SARA extreme scenario | 67,208 MW load + 13,953 MW extreme thermal outages leaves 1,352 MW reserves (below the 2,300 MW EEA risk level); "extreme low wind" scenario -5,279 MW (wind 1,791 MW); low wind + extreme load + extreme outages (not published) would be -3,927 MW | [CALIBRATION-SAFE] | [FERC-NERC-2021 pp.32-34](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf); [SARA-W2021](https://www.ercot.com/files/docs/2020/11/05/SARA-FinalWinter2020-2021.pdf) |
| SARA wind assumptions | nameplate ~24,962 MW; winter peak contribution 7,070 MW (coastal 43%, panhandle 32%, other 19% of installed) | [CALIBRATION-SAFE] | [FERC-NERC-2021 p.34 fn.66](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| SARA thermal outage basis | 8,616 MW = historical Dec-Feb weekday 7-10 AM outages for winters 2017/18-2019/20 | [CALIBRATION-SAFE] | [FERC-NERC-2021 p.34 fn.67](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| NERC 2020/21 Winter Reliability Assessment (ERCOT) | anticipated reserve margin 49.8%; extreme winter peak 67,200 MW | [CALIBRATION-SAFE] (Nov 2020 NERC doc, read via FERC-NERC-2021) | [FERC-NERC-2021 p.38](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |

---

## 3. February 2021 Winter Storm Uri (ERCOT)

Every row in Section 3 is **[TEST-ONLY]**.

### 3.1 Timeline, Feb 8-20, 2021

| When | Event | Tag | Source |
|---|---|---|---|
| Feb 8 | ERCOT cold-weather notices; first wind blade-icing outages reported at 7:50 AM; temperatures below freezing | [TEST-ONLY] | [FERC-NERC-2021 pp.12, 94](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Feb 10 | freezing precipitation begins; gas supply restrictions start (Atmos Pipeline restrictions announced, effective Feb 12) | [TEST-ONLY] | [FERC-NERC-2021 p.94](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf); [UT-2021 p.32](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Feb 12 | load peaks at 63,997 MW (97% of the prior winter record); fuel supply emergency declared 3:30-5:11 PM | [TEST-ONLY] | [FERC-NERC-2021 p.95](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Feb 13 | PRC < 3,000 MW Advisory at 8:43 AM; peak 64,132 MW at 11 AM (footnote: 64,181 MW) | [TEST-ONLY] | [FERC-NERC-2021 pp.95, 128](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Feb 14 | Advisory 11:33 AM; Watch 3:17 PM; **all-time winter peak 69,871 MW at HE 8 PM** (other values below); ~6,000 MW of new outages from 10 PM to 3 AM, 52-60% freezing; PRC < 3,000 MW Advisory 11:32 PM | [TEST-ONLY] | [FERC-NERC-2021 pp.128-131](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Feb 15 00:15 | EEA 1 (PRC < 2,300 MW since 12:09); 847 MW ERS-30 deployed | [TEST-ONLY] | [FERC-NERC-2021 p.134](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Feb 15 01:07 | EEA 2 (frequency < 59.91 Hz for more than 7 min); 51.6 MW ERS-10; Load Resources groups 1-2 deployed (load fell from 65,000 to 64,577 MW) | [TEST-ONLY] | [FERC-NERC-2021 p.134](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Feb 15 01:20 | EEA 3; first 1,000 MW firm load shed (PRC 1,377 MW, below the 1,430 MW criterion); load 64,256 MW | [TEST-ONLY] | [FERC-NERC-2021 p.135](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Feb 15 ~01:51-02:02 | frequency crisis (see 3.4) | [TEST-ONLY] | see 3.4 |
| Feb 15 ~09:00 | outages and derates > 50,000 MW nameplate (~40% of installed) | [TEST-ONLY] | [UT-2021 p.29](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Feb 15 ~19:00 (7:15 PM) | **maximum firm load shed, 20,000 MW** | [TEST-ONLY] | [FERC-NERC-2021 pp.14, 139](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Feb 16 08:00 | maximum unavailable generation, 52,037 MW (ERCOT RFI-based) | [TEST-ONLY] | [ERCOT-Causes-0427 slide 8](https://www.ercot.com/files/docs/2021/04/28/ERCOT_Winter_Storm_Generator_Outages_By_Cause_Updated_Report_4.27.21.pdf) |
| Feb 16 | no net gain in generation; outages cut during the day, raised for the evening peak | [TEST-ONLY] | [ERCOT-Board-0224 slide 16](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf) |
| Feb 17 23:55 | ERCOT instructs restoration of all remaining shed load | [TEST-ONLY] | [FERC-NERC-2021 p.157](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Feb 18 00:42 | last controlled-outage orders cancelled (some customers stay out from ice damage) | [TEST-ONLY] | [ERCOT-Board-0224 slide 16](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf) |
| Feb 19 | 9:00 AM EEA 2; ~10:00 AM EEA 1; 10:35 AM normal operations (UT: 10:36) | [TEST-ONLY] | [ERCOT-Board-0224 slide 16](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf); [FERC-NERC-2021 p.157](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Feb 20 | end of the FERC-NERC event window (Feb 8-20) | [TEST-ONLY] | [FERC-NERC-2021 p.8](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |

Weather (all [TEST-ONLY]):

| Fact | Value | Tag | Source |
|---|---|---|---|
| Lows, week of Feb 14 | Austin 6 °F, Dallas 8 °F, Houston 10 °F (FERC narrative); Dallas 4 °F on the morning of Feb 15 vs normal 39 °F | [TEST-ONLY] | [FERC-NERC-2021 pp.14, 123](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Dallas coldest | -2 °F (ERCOT) | [TEST-ONLY] | [ELLIOTT-PUB §9](https://www.ercot.com/files/docs/2023/03/27/December-2022-Cold-Weather-Operations-Public-Report.pdf) |
| Deviation from average daily minimum | 40-50 °F below average on Feb 15 | [TEST-ONLY] | [FERC-NERC-2021 pp.12-13](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Consecutive hours at or below freezing | DFW 140 h, Austin 162 h, Houston 44 h | [TEST-ONLY] | [ERCOT-Board-0224 slide 18](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf) |

### 3.2 Forced outages over time

ERCOT unavailable generation by cause, FERC-NERC Figure 66a (nameplate MW). Percent is of 123,057 MW installed. The column alignment was rebuilt from PDF text, and every column sums exactly: planned + 10,633 MW of pre-event unplanned + incremental = total.

| Time | Planned | Unplanned total | Freezing | Fuel | Mech/Elec | Other | Total unavailable | % installed | Tag |
|---|---|---|---|---|---|---|---|---|---|
| Feb 8 00:00 (pre-event) | 3,079 | 10,633 | n/a | n/a | n/a | n/a | 13,712 | 11.1% | [TEST-ONLY] |
| Feb 14 00:00 | 1,859 | 22,884 | 13,712 | 4,259 | 4,675 | 238 | 24,743 | 20.1% | [TEST-ONLY] |
| Feb 15 00:00 | 1,859 | 26,417 | 17,308 | 2,435 | 5,659 | 1,015 | 28,276 | 23.0% | [TEST-ONLY] |
| Feb 15 12:00 | 1,859 | 44,923 | 29,680 | 4,194 | 7,432 | 3,617 | 46,782 | 38.0% | [TEST-ONLY] |
| **Feb 15 13:05 (ERCOT peak, FERC basis)** | 1,812 | **45,932** | 29,704 | 4,400 | 8,211 | 3,617 | **47,744** | 38.8% | [TEST-ONLY] |
| Feb 16 00:00 | 1,859 | 44,188 | 27,548 | 6,239 | 8,237 | 2,164 | 46,047 | 37.4% | [TEST-ONLY] |
| Feb 16 12:00 | 1,812 | 43,278 | 26,143 | 6,320 | 9,037 | 1,778 | 45,090 | 36.6% | [TEST-ONLY] |
| Feb 16 17:00 | 1,812 | 43,300 | 26,918 | 6,746 | 8,038 | 1,598 | 45,112 | 36.7% | [TEST-ONLY] |

Source: [FERC-NERC-2021 Fig.66a, p.125](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf)

| Fact | Value | Tag | Source |
|---|---|---|---|
| ERCOT peak unavailable (first estimate) | 52,277 MW = 48.6% of 107,514 MW installed (~25,000 MW forced incl. 14,000 MW wind/solar; ~2,800 MW planned incl. mothballed) | [TEST-ONLY] | [ERCOT-Board-0224 slides 10, 13](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf) |
| **ERCOT peak unavailable (revised)** | **52,037 MW at ~8:00 AM Feb 16**: weather 27,567 MW (53%); existing outages 7,650 (15%); equipment 7,457 (14%); fuel limitations 6,130 (12%); transmission loss 1,459 (3%); frequency-related 1,262 (2%); misc 512 (1%) | [TEST-ONLY] | [ERCOT-Causes-0427 slide 8](https://www.ercot.com/files/docs/2021/04/28/ERCOT_Winter_Storm_Generator_Outages_By_Cause_Updated_Report_4.27.21.pdf) |
| Average unavailable, expected-capacity basis | ~34,000 MW from 7 AM Feb 15 to 1 PM Feb 17 | [TEST-ONLY] | [FERC-NERC-2021 p.8](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Outages by fuel, noon Feb 14 to noon Feb 15 (nameplate) | wind 14,600 to 18,300 MW; gas 12,000 to 25,000; coal 1,500 to 4,500; nuclear 0 to 1,300 (one STP unit); solar 500 to 1,100 | [TEST-ONLY] | [UT-2021 p.33](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Same, wind/solar on backcast basis | wind 9,070 to 5,020 MW; solar 108 to 545 MW | [TEST-ONLY] | [UT-2021 p.33 fn.55](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Thermal vs renewable offline, noon Feb 14 to noon Feb 15 | thermal 13,700 to 31,100 MW; renewable 15,100 to 19,400 MW | [TEST-ONLY] | [UT-2021 p.29](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Weather-related offline | 15,000 MW (noon Feb 14) to 30,000 MW (noon Feb 15); ~167 units | [TEST-ONLY] | [UT-2021 pp.30-31](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Gas fuel-limitation outages | 3,500 MW (noon Feb 14) to 6,700 MW (10 AM Feb 17); coal fuel issues max 2,100 MW (4 PM Feb 16); 131 units cited fuel | [TEST-ONLY] | [UT-2021 p.31](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Cumulative gas generation derated for supply | 9,323 MW (vs 1,282 MW in 2011) | [TEST-ONLY] | [ERCOT-Board-0224 slide 19](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf) |
| Frequency-related generator trips | up to ~1,800 MW (8 units, mostly coal) at 2 AM Feb 15 | [TEST-ONLY] | [UT-2021 pp.26, 33](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Units affected | 356 cumulative (2011 FERC method; vs 193 in 2011); ~585 units reported outages/derates (UT); 96 of 585 also failed in 2011 | [TEST-ONLY] | [ERCOT-Board-0224 slide 19](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf); [UT-2021 pp.74-75](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Cumulative capacity forced out (2011 method) | 46,249 MW (vs 29,729 MW in 2011); forced out 1 h before EEA3: 2,489 MW (vs 1,182 MW in 2011) | [TEST-ONLY] | [ERCOT-Board-0224 slide 19](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf) |
| Freezing share of ERCOT outage events | ~48% (by count) | [TEST-ONLY] | [FERC-NERC-2021 p.167](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Avoidable share | protecting transmitters, sensing lines, instrumentation and blades could have cut ERCOT outaged MW by 67% | [TEST-ONLY] | [FERC-NERC-2021 p.167](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Units with no winterization plan | 26 ERCOT units (7%, 3,675 MW) | [TEST-ONLY] | [FERC-NERC-2021 p.17](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Event-area causes (ERCOT + SPP + MISO South) | 1,045 units, 4,124 outage events; freezing 44.2%, fuel 31.4% (87% of fuel = gas supply), mech/elec 21.1%; 58% gas units; 81% of freeze outages occurred above the unit's stated design temperature | [TEST-ONLY] | [FERC-NERC-2021 pp.15-17](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Gas production | US Lower 48 down 28% (Feb 8-17); TX+OK+LA down ~21 Bcf/d (>50% vs January) at the Feb 17 low | [TEST-ONLY] | [FERC-NERC-2021 p.13](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Wind output during load shed | averaged ~3,100 MW over Feb 15-17, as low as ~500 MW (vs 7,070 MW in the SARA) | [TEST-ONLY] | [FERC-NERC-2021 p.182](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Gas-curtailment-driven outages, start of Feb 15 | ~2,300 MW | [TEST-ONLY] | [FERC-NERC-2021 p.123](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |

### 3.3 Load shed

| Fact | Value | Tag | Source |
|---|---|---|---|
| First firm load shed | 1:20 AM Feb 15, 1,000 MW | [TEST-ONLY] | [FERC-NERC-2021 p.135](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Ramp, early Feb 15 (cumulative ordered) | 1:20 1,000; 1:45 2,000; 1:50 5,000; 1:55 8,500; 2:00 10,500 MW; 2:30 restore 1,500 (9,000 still out) | [TEST-ONLY] | [FERC-NERC-2021 pp.136-138](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| **Maximum firm load shed** | **20,000 MW** by ~7 PM (7:15 PM) Feb 15; 14-28% of peak load; UT: 26% of peak | [TEST-ONLY] | [FERC-NERC-2021 pp.14, 139, 183](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf); [UT-2021 p.74](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Average shed over the event | ~14,000 MW over 70.5 h | [TEST-ONLY] | [DALLASFED](https://www.dallasfed.org/research/economics/2021/0415) |
| Load-shed duration | 70.5 h (1:20 AM Feb 15 to ~11:55 PM Feb 17); "over 70 hours" | [TEST-ONLY] | [ERCOT-Board-0224 slide 19](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf); [FERC-NERC-2021 Fig.18](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| EEA 3 duration | ~105 h | [TEST-ONLY] | [UT-2021 p.74](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Event-area total | 23,418 MW (ERCOT 20,000; SPP 2,718; MISO South 700): largest controlled firm load shed in US history | [TEST-ONLY] | [FERC-NERC-2021 pp.9, 50](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Rotation problem | 25% of load must stay on UFLS circuits plus critical loads, so rotation was hard and UFLS circuits were used for manual shed (>1,000 circuits, possibly >2,000) | [TEST-ONLY] | [FERC-NERC-2021 p.156](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf); [UT-2021 p.40](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Critical gas facilities | Oncor began with 35 gas sites on its "do not cut" list and added 168 during the event | [TEST-ONLY] | [UT-2021 p.32](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Imports available | max ~1,220 MW over DC ties | [TEST-ONLY] | [FERC-NERC-2021 p.127 fn.197](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |

### 3.4 The frequency event, early Feb 15 (the "4:37")

| Fact | Value | Tag | Source |
|---|---|---|---|
| Frequency at 11:32 PM Feb 14 | 59.963 Hz | [TEST-ONLY] | [FERC-NERC-2021 p.133](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| 1:35-1:44 AM | 59.978 to 59.823 Hz as >1,500 MW of units tripped or ran back | [TEST-ONLY] | [FERC-NERC-2021 p.135](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| 1:44-1:49 AM | 5 more units (1,712 MW) lost; 59.817 to 59.504 Hz | [TEST-ONLY] | [FERC-NERC-2021 p.136](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| **Fell below 59.4 Hz** | **~1:51 AM**; starts the 9-minute generator relay clock | [TEST-ONLY] | [FERC-NERC-2021 p.137](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| **Minimum frequency** | **59.302 Hz** at ~1:55 AM (ERCOT, UT); 59.304 Hz at 1:54 AM (FERC-NERC) | [TEST-ONLY] | [ERCOT-Board-0224 slide 12](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf); [UT-2021 p.26](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf); [FERC-NERC-2021 p.137](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Automatic UFLS | ~276 MW tripped near 59.3 Hz (FERC-NERC); ~200 MW on 2-3 dozen circuits (UT) | [TEST-ONLY] | [FERC-NERC-2021 p.137](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf); [UT-2021 p.40](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| **Time below 59.4 Hz** | **4 min 23 s** (back to 59.401 Hz at ~1:55 AM) | [TEST-ONLY] | [ERCOT-Board-0224 slide 12](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf); [FERC-NERC-2021 p.137](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| The 9-minute limit | generator UF relays may trip after 9 min at 59.4 Hz or below; ~17,000 MW would have tripped, risking a full ERCOT blackout | [TEST-ONLY] (the rule itself is CALIBRATION-SAFE, see 6.3) | [FERC-NERC-2021 pp.14, 137](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| **"4 minutes 37 seconds"** | 9:00 minus 4:23 = 4:37 of margin left. It comes from ERCOT's Feb 24, 2021 board timeline (slide: "Below 59.4 Hz for 4m 23s ... if below 59.4 for 9m or more"), presented by CEO Bill Magness. The phrase "4 minutes and 37 seconds away from collapsing" was reported by KUT 90.5 (Matt Largey, Feb 24, 2021) and syndicated by Texas Standard, TPR and KERA. FERC-NERC says only "over four minutes". | [TEST-ONLY] | [KUT](https://www.kut.org/energy-environment/2021-02-24/texas-power-grid-was-4-minutes-and-37-seconds-away-from-collapsing-heres-how-it-happened); [ERCOT-Board-0224 slide 12](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf) |
| Back above 60 Hz | 2:02 AM (60.094 Hz at 2:09) | [TEST-ONLY] | [FERC-NERC-2021 p.138](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| PRC during the crisis | 1,435 MW (1:50), 1,044 MW (1:54), 1,127 MW (1:55), 2,952 MW (2:09); PRC < 1,430 MW for ~4.5 h Feb 15, 1.9 h Feb 16, 0.7 h Feb 17 | [TEST-ONLY] | [FERC-NERC-2021 pp.137-138](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Frequency sensitivity | -2.59 mHz/s per 100 MW lost (1:18 AM); -4.35 mHz/s per 100 MW (1:20 AM) | [TEST-ONLY] | [FERC-NERC-2021 p.134-135](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| System inertia during the event | 254-349 GW·s (well above critical) | [TEST-ONLY] | [FERC-NERC-2021 p.138](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |

### 3.5 Demand, customers, deaths, cost

| Fact | Value | Tag | Source |
|---|---|---|---|
| Actual winter peak before shed | 69,871 MW HE 8 PM Feb 14 (FERC-NERC); see Conflicts for 69,150-69,812 variants | [TEST-ONLY] | [FERC-NERC-2021 p.129](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| **ERCOT estimate of demand without load shed** | **76,819 MW peak** (hourly backcast); 75,573 MW for 8 AM Feb 15 | [TEST-ONLY] | [ERCOT-Board-0224 slide 19](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf); [UT-2021 pp.25, 28](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Forecast error | backcast peak ~19,120 MW above the normal-weather forecast (57,699) and >9,500 MW (~14%) above the SARA extreme (67,208) | [TEST-ONLY] | [UT-2021 pp.8, 28](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| **Customers without power** | ~4.5 million (FERC-NERC: "people"; UT: customers/meters); DOE peak Texas outages 4,893,204 customers (controlled + storm damage, excluding Pedernales); ">4 million customers" on the afternoon of Feb 16 | [TEST-ONLY] | [FERC-NERC-2021 p.9](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf); [UT-2021 p.74](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf); [DOE Situation Update #3, Feb 18, 2021](https://www.energy.gov/ceser/articles/extreme-cold-winter-weather-hub-situation-update-3) |
| Outage duration | some up to 4 days with >6 days below freezing (FERC-NERC); survey average 42 h, average longest continuous outage 31 h, 2/3 of ERCOT residents lost power (UH Hobby School, Mar 2021); 46 h (May 2021 survey) | [TEST-ONLY] | [FERC-NERC-2021 p.9](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf); [Texas Standard on Hobby survey](https://texasstandard.org/stories/two-thirds-of-texans-surveyed-said-they-lost-power-during-februarys-winter-storm-the-average-outage-was-42-hours/); [UH Hobby](https://uh.edu/hobby/electricgrid/) |
| Water | >14 million under boil-water orders (FERC-NERC); up to 12 million (UT) | [TEST-ONLY] | [FERC-NERC-2021 p.10](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf); [UT-2021 p.100](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| **Deaths (official)** | **246** (Texas DSHS final, Dec 31, 2021: 148 direct, 92 indirect, 6 possible; 161 cold exposure incl. 158 hypothermia; Feb 11 to Jun 4 window, 77 counties). Earlier: 151 (May 2021), 210 (Jul 2021; FERC-NERC uses "at least 210") | [TEST-ONLY] | [KSAT/AP on DSHS final](https://www.ksat.com/news/texas/2022/01/02/texas-puts-final-estimate-of-winter-storm-death-toll-at-246/); [FERC-NERC-2021 p.9](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Deaths (excess-mortality estimate) | 702 (range 426-978) for the week ending Feb 20 (BuzzFeed News, May 2021) | [TEST-ONLY] | [BuzzFeed News](https://www.buzzfeednews.com/article/peteraldhous/texas-winter-storm-power-outage-death-toll) |
| **Economic cost** | Dallas Fed: $80-130 billion direct + indirect; insured $10-20B; outage cost $4.3B via VOLL | [TEST-ONLY] | [DALLASFED](https://www.dallasfed.org/research/economics/2021/0415) |
| Economic cost (alternative) | Perryman Group preliminary: $195-295 billion | [TEST-ONLY] | [Perryman brief, Feb 25, 2021](https://www.perrymangroup.com/media/uploads/brief/perryman-preliminary-estimates-of-economic-costs-of-the-february-2021-texas-winter-storm-02-25-21.pdf); [CBS](https://www.cbsnews.com/news/texas-winter-storm-uri-costs/) |
| Wholesale market | PUCT orders held prices at $9,000/MWh; without them, energy costs that week would have been ~$5.2B (~11%) higher | [TEST-ONLY] | [UT-2021 pp.63-64](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |

---

## 4. Winter Storm Elliott, December 22-25, 2022 (ERCOT)

| Fact | Value | Tag | Source |
|---|---|---|---|
| Peak demand | **74,525 MW** (final, Dec 23, 7-8 AM). Preliminary: 74,427 MW (Dec 2022 overview), 73,910 MW HE9 Dec 23 and 73,658 MW HE22 Dec 22 (board), 74,100 MW "instantaneous" (public report) | [TEST-ONLY] | [ERCOT Monthly Jan 2024](https://www.ercot.com/files/docs/2024/01/31/ERCOT-Monthly-January-2024.pdf); [ERCOT Dec 2022 overview](https://www.ercot.com/files/docs/2023/01/18/ERCOT-Monthly-Operational-Overview-December-2022.pdf); [ELLIOTT-BRD slide 3](https://www.ercot.com/files/docs/2023/02/21/7-Review-of-Winter-Storm-Elliott.pdf); [ELLIOTT-PUB](https://www.ercot.com/files/docs/2023/03/27/December-2022-Cold-Weather-Operations-Public-Report.pdf) |
| Outages | 11,988 MW pre-existing (start of Dec 22, mostly forced); **max outage + derate 19,885 MW at 08:00 Dec 23**; ~4,500 MW of it cold- or fuel-related | [TEST-ONLY] | [ELLIOTT-PUB §8](https://www.ercot.com/files/docs/2023/03/27/December-2022-Cold-Weather-Operations-Public-Report.pdf) |
| Reserves | PRC minimum 4,052 MW (~8:33 PM Dec 23); EEA 1 trigger is 2,300 MW | [TEST-ONLY] | [ELLIOTT-PUB](https://www.ercot.com/files/docs/2023/03/27/December-2022-Cold-Weather-Operations-Public-Report.pdf) |
| **Load shed?** | **No.** No EEA, no Watch or Advisory for reserves. Elsewhere in the Eastern Interconnection ~5,000 MW was shed (TVA, Duke and others) | [TEST-ONLY] | [ELLIOTT-PUB](https://www.ercot.com/files/docs/2023/03/27/December-2022-Cold-Weather-Operations-Public-Report.pdf); [Power Engineering on FERC-NERC](https://www.power-eng.com/operations-maintenance/outage-management/ferc-nerc-staff-find-unprecedented-outages-from-winter-storm-elliott/) |
| Temperature | Dallas coldest 11 °F (vs -2 °F in Uri); colder than at EEA entry on Feb 15, 2021, and load >4,000 MW higher | [TEST-ONLY] | [ELLIOTT-PUB §9, §14](https://www.ercot.com/files/docs/2023/03/27/December-2022-Cold-Weather-Operations-Public-Report.pdf) |
| Other | DC tie imports ~1,139 MW at peak; large flexible loads cut 1,530 to 130 MW; Firm Fuel Supply Service (48 h on-site fuel) used; 4 of 255 inspected resources had weather outages | [TEST-ONLY] | [ELLIOTT-PUB](https://www.ercot.com/files/docs/2023/03/27/December-2022-Cold-Weather-Operations-Public-Report.pdf) |

## 5. August 2023 heat wave and the September 6, 2023 EEA

| Fact | Value | Tag | Source |
|---|---|---|---|
| Record demand | **85,508 MW, Aug 10, 2023** (settled; preliminary 85,435 / 85,464 MW); prior record 82,939 MW (Jul 31, 2023) | [TEST-ONLY] | [ERCOT yearly peak records](https://www.ercot.com/static-assets/data/news/content/a-peak-demand/all-time-records.htm); [SYSOPS-2023-10](https://www.ercot.com/files/docs/2023/10/09/7.2%20System%20Operations%20Update.pdf) |
| Conservation appeals | 11 in 2023 (the Sept 7 request was the 11th) plus one EEA | [TEST-ONLY] | [KBTX](https://www.kbtx.com/2023/09/07/ercot-issues-11th-conservation-appeal-summer); [KERA](https://www.keranews.org/texas-news/2024-01-19/why-does-ercot-issue-so-many-requests-for-texas-to-conserve-energy) |
| Sept 6 demand | new September record 82,705 MW (preliminary); Dallas 105 °F | [TEST-ONLY] | [Utility Dive](https://www.utilitydive.com/news/ercot-declares-emergency-conditions-extreme-heat-texas-blackouts/692963/); [SYSOPS-2023-10 slide 15](https://www.ercot.com/files/docs/2023/10/09/7.2%20System%20Operations%20Update.pdf) |
| Sept 6 sequence | ECRS and non-spin used from 2:57 PM; RRS released 6:59 PM; South Texas export constraint forced curtailment; **frequency declined from 7:10 PM to a low of 59.769 Hz at ~7:25 PM**; an 80 MW unit tripped; **EEA 2 at 7:25 PM** (EEA 1 skipped) with Load Resources deployed; 60 Hz restored 7:37 PM; EEA 1 at 8:27 PM; normal at 8:37 PM | [TEST-ONLY] | [SYSOPS-2023-10 slides 15-17](https://www.ercot.com/files/docs/2023/10/09/7.2%20System%20Operations%20Update.pdf) |
| Highest emergency level | EEA 2; no controlled outages. Reported PRC (>2,000 MW) was later judged inaccurate | [TEST-ONLY] | [SYSOPS-2023-10 slide 17](https://www.ercot.com/files/docs/2023/10/09/7.2%20System%20Operations%20Update.pdf) |
| Conservation appeal, Sept 6 | issued in the afternoon (~4:55 PM per APPA) and kept in effect until 9 PM | [TEST-ONLY] | [APPA Public Power](https://www.publicpower.org/node/22569) |
| Context (outside scope) | unofficial new all-time peak 91,089 MW on Jul 22, 2026 | [TEST-ONLY] | [ERCOT yearly peak records](https://www.ercot.com/static-assets/data/news/content/a-peak-demand/all-time-records.htm) |

---

## 6. ERCOT operating parameters

### 6.1 Frequency basics

| Parameter | Value | Tag | Source |
|---|---|---|---|
| Nominal frequency | 60 Hz | [CALIBRATION-SAFE] | [FERC-2011 p.84](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Frequency trouble threshold (1989 narrative) | 59.95 Hz (frequency below this marked the system as in difficulty) | [CALIBRATION-SAFE] | [FERC-2011 pp.173-174](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Normal frequency band | 59.95-60.05 Hz | [TEST-ONLY] (describes pre-2021 state) | [FERC-NERC-2021 p.134](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| ERCOT is asynchronous | only DC ties: max import 1,090 MW in 2011 (North 210, East 600, Eagle Pass 30, Railroad 150, Laredo VFT 100) | [CALIBRATION-SAFE] | [FERC-2011 p.25](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| DC tie import limit (2021) | ~1,220 MW | [TEST-ONLY] (describes pre-2021 state) | [FERC-NERC-2021 p.127](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf); [EEA-2021](https://www.ercot.com/files/docs/2021/06/11/2021_EEA_Overview_Final.pdf) |

### 6.2 Under-frequency load shedding (UFLS)

| Stage | Threshold | Load shed | Tag | Source |
|---|---|---|---|---|
| 1 | 59.3 Hz | ≥5% of load (~2,600 MW in Feb 2011) | [CALIBRATION-SAFE] | [FERC-2011 pp.85, 90 fn.135](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| 2 | 58.9 Hz | additional ≥10% (cumulative 15%) | [CALIBRATION-SAFE] | same |
| 3 | 58.5 Hz | additional ≥10% (cumulative 25%) | [CALIBRATION-SAFE] | same |
| Reserve rule | 25% of load must stay on UFLS relays, kept separate from manual-shed circuits | | [CALIBRATION-SAFE] | [FERC-2011 p.90](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Load Resources (interruptible RRS) | auto-trip at 59.7 Hz (relays set no lower than 59.7 Hz) | | [CALIBRATION-SAFE] | [FERC-2011 p.85](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf); [AS-2020 p.11](https://www.ercot.com/files/docs/2019/12/03/8_2020_ERCOT_Methodologies_for_Determining_Minimum_Ancillary_Service_Requirements.pdf) |

The 2021 report confirms the same cumulative 5/15/25% at 59.3/58.9/58.5 Hz ([FERC-NERC-2021 p.44](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf)). [TEST-ONLY] source, consistent with the safe source above.

### 6.3 Generator under-frequency trip settings (the "59.4 Hz for 9 minutes" rule)

In effect from April 1, 2015 (NOGRR 139, approved Mar 26, 2015), so it covers Uri:

| Frequency range | Minimum delay before trip | Tag | Source |
|---|---|---|---|
| > 59.4 Hz | no automatic tripping (continuous operation) | [CALIBRATION-SAFE] | [NOGRR139](https://www.ercot.com/files/docs/2015/03/27/139NOGRR_10_TAC_Report_032615.doc) |
| > 58.4 to ≤ 59.4 Hz | not less than 9 minutes | [CALIBRATION-SAFE] | same |
| > 58.0 to ≤ 58.4 Hz | not less than 30 seconds | [CALIBRATION-SAFE] | same |
| > 57.5 to ≤ 58.0 Hz | not less than 2 seconds | [CALIBRATION-SAFE] | same |
| ≤ 57.5 Hz | no time delay required | [CALIBRATION-SAFE] | same |

Rationale: risk of turbine blade damage below 59.4 Hz (NOGRR 139 discussion). The same table appears in [FERC-NERC-2021 Fig.16](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) and is consistent with NERC PRC-024-2.

### 6.4 System inertia

| Parameter | Value | Tag | Source |
|---|---|---|---|
| Critical inertia (computed) | 94 GW·s: the level at which an N-2 loss of 2,750 MW takes 0.416 s to fall from 59.7 to 59.3 Hz | [CALIBRATION-SAFE] | [ERCOT-Inertia-2018 §6](https://www.ercot.com/files/docs/2018/04/04/Inertia_Basic_Concepts_Impacts_On_ERCOT_v0.pdf) |
| Critical inertia (operational, with margin) | 100 GW·s | [CALIBRATION-SAFE] | same |
| Control room thresholds | ≥120 GW·s normal; 110-120 yellow; 100-110 orange; ≤100 red; act below 105 GW·s | [CALIBRATION-SAFE] | [ERCOT-Inertia-2018 §7](https://www.ercot.com/files/docs/2018/04/04/Inertia_Basic_Concepts_Impacts_On_ERCOT_v0.pdf) |
| Annual minimum inertia | 2013: 132; 2014: 135; 2015: 152; 2016: 143; 2017: 130 GW·s (lowest ever, Oct 27, 2017 4 AM, load 28,425 MW, 54% non-synchronous) | [CALIBRATION-SAFE] | [ERCOT-Inertia-2018 Table 2](https://www.ercot.com/files/docs/2018/04/04/Inertia_Basic_Concepts_Impacts_On_ERCOT_v0.pdf) |
| Typical range | roughly 150 to ~380 GW·s (read from the 2013-2017 boxplot); highest in summer, lowest in shoulder months | [CALIBRATION-SAFE] (approximate, read from figure) | [ERCOT-Inertia-2018 Fig.5](https://www.ercot.com/files/docs/2018/04/04/Inertia_Basic_Concepts_Impacts_On_ERCOT_v0.pdf) |
| Always-on floor | ~68 GW·s (2 nuclear units 12 + RRS generators 24 + private-use networks 32) | [CALIBRATION-SAFE] | [ERCOT-Inertia-2018 §8](https://www.ercot.com/files/docs/2018/04/04/Inertia_Basic_Concepts_Impacts_On_ERCOT_v0.pdf) |
| Uri observed | 254-349 GW·s | [TEST-ONLY] | [FERC-NERC-2021 p.138](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |

### 6.5 Contingencies and reserves

| Parameter | Value | Tag | Source |
|---|---|---|---|
| Responsive reserve minimum | 2,300 MW (1988 study, N-2: one nuclear unit + next largest) | [CALIBRATION-SAFE] | [FERC-2011 pp.54, 84](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Largest single contingency (N-1) | 1,354 MW (South Texas Project nuclear unit), 2011 | [CALIBRATION-SAFE] | [FERC-2011 p.73 fn.113](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| N-2 contingency used for inertia studies | 2,750 MW (2018); resource contingency criterion 2,805 MW in 2020 RRS studies | [CALIBRATION-SAFE] | [ERCOT-Inertia-2018 §6](https://www.ercot.com/files/docs/2018/04/04/Inertia_Basic_Concepts_Impacts_On_ERCOT_v0.pdf); [AS-2020](https://www.ercot.com/files/docs/2019/12/03/8_2020_ERCOT_Methodologies_for_Determining_Minimum_Ancillary_Service_Requirements.pdf) |
| Load Resource share of RRS | up to 50% (1,150 of 2,300 MW) in 2011; capped at 60% in 2020 methodology | [CALIBRATION-SAFE] | [FERC-2011 p.85](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf); [AS-2020 p.11](https://www.ercot.com/files/docs/2019/12/03/8_2020_ERCOT_Methodologies_for_Determining_Minimum_Ancillary_Service_Requirements.pdf) |
| RRS from primary frequency response (generation) | ≥1,150 MW; RRS quantity varies by month and 4-hour block, sized to cover 70% of historic inertia conditions | [CALIBRATION-SAFE] | [AS-2020 p.11](https://www.ercot.com/files/docs/2019/12/03/8_2020_ERCOT_Methodologies_for_Determining_Minimum_Ancillary_Service_Requirements.pdf) |
| Non-spin | 30-min resources; requirement 2,000 MW (Feb 2011); 2020 method uses 70th-95th percentile of net-load forecast error | [CALIBRATION-SAFE] | [FERC-2011 p.55](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf); [AS-2020 p.8](https://www.ercot.com/files/docs/2019/12/03/8_2020_ERCOT_Methodologies_for_Determining_Minimum_Ancillary_Service_Requirements.pdf) |
| NERC most severe single contingency (2021) | 1,430 MW; also the EEA 3 PRC criterion used in Feb 2021 | [TEST-ONLY] (describes pre-2021 state) | [FERC-NERC-2021 pp.133-135](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| PRC alert ladder | Advisory if PRC < 3,000 MW; Watch if PRC < 2,500 MW | [CALIBRATION-SAFE] | [SUM2019](https://www.ercot.com/files/docs/2019/10/01/5.1_Summer_2019_Operational_and_Market_Review.pdf); [ERCOT-EEA-2014](https://www.ercot.com/files/docs/2014/03/07/ros_jan_6_eea_report.pdf) |

### 6.6 Energy Emergency Alert levels (by period)

| Period | EEA 1 | EEA 2 | EEA 3 (firm load shed) | Tag | Source |
|---|---|---|---|---|---|
| 2011 | reserves < 2,300 MW: DC ties, start uncommitted units | 2A: < 1,750 MW, deploy Load Resources; 2B: keep 60 Hz, deploy EILS | keep frequency ≥ 59.8 Hz; rotating outages in 100 MW blocks | [CALIBRATION-SAFE] | [FERC-2011 p.75](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| 2016 desk procedure | PRC < 2,300 MW, not recoverable in 30 min | PRC < 1,750 MW or cannot hold 59.91 Hz | PRC < 1,000 MW or cannot hold 59.80 Hz; steady-state < 59.8 Hz: CAN go to EEA 3; < 59.5 Hz: SHALL go to EEA 3 | [CALIBRATION-SAFE] | [POB754](https://www.ercot.com/files/pobs/2016/07/15/Power_Operations_Bulletin_754.doc) |
| June 2019 public description | < 2,300 MW (30 min) | < 1,750 MW (30 min) | < 1,000 MW (30 min): rotating outages, typically 10-45 min per location | [CALIBRATION-SAFE] | [EEA-2019](https://www.ercot.com/files/docs/2019/09/17/EEA_OnePager_FINAL_June2019.pdf) |
| Feb 2021 (as applied in Uri) | PRC < 2,300 MW | PRC < 1,750 MW or freq < 59.91 Hz | PRC < 1,430 MW | [TEST-ONLY] | [FERC-NERC-2021 pp.134-135](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| May 2021 public description | < 2,300 MW (imports up to 1,220 MW; switchable gen up to 434 MW; ERS-30 820 MW) | < 1,750 MW (Load Resources 898 MW; TDSP load management 270 MW; voltage reduction 100-200 MW; ERS-10 820 MW) | enter at < 1,375 MW; shed at < 1,000 MW or if 60 Hz cannot be held | [TEST-ONLY] | [EEA-2021](https://www.ercot.com/files/docs/2021/06/11/2021_EEA_Overview_Final.pdf) |
| From Nov 2023 | 2,500 MW | 2,000 MW, or < 59.91 Hz for 15 min (was 30) | < 1,500 MW, or < 59.8 Hz at any time | [TEST-ONLY] | [APPA, Nov 3, 2023](https://www.publicpower.org/periodical/article/ercot-updates-minimum-operating-reserves-emergency-conditions) |

### 6.7 Load shed mechanics

| Parameter | Value | Tag | Source |
|---|---|---|---|
| Allocation | by each TSP's share of the prior year's peak load | [CALIBRATION-SAFE] | [FERC-2011 p.89](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Implementation time | 30 min via SCADA; 1 h with field crews (does not apply to orders > 1,000 MW) | [CALIBRATION-SAFE] | [FERC-2011 p.89](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Rotation | 10-45 min per location (2019 description); 15 to 30-45 min targets (2011) | [CALIBRATION-SAFE] | [EEA-2019](https://www.ercot.com/files/docs/2019/09/17/EEA_OnePager_FINAL_June2019.pdf); [FERC-2011 p.90](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Rule of thumb | 1 MW ≈ 200 Texas homes at peak | [CALIBRATION-SAFE] | [FACT-2020](https://www.ercot.com/files/docs/2020/11/10/ERCOT_Fact_Sheet_11.10.20.pdf) |

### 6.8 Emergency demand response (EILS/ERS)

| Parameter | Value | Tag | Source |
|---|---|---|---|
| EILS contracted, Feb 2011 | 331 MW (384.2 MW deployed Feb 2) | [CALIBRATION-SAFE] | [FERC-2011 pp.53, 87](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| ERS deployed, Jan 6, 2014 | ERS-30 112 MW + ERS-10 508 MW | [CALIBRATION-SAFE] | [ERCOT-EEA-2014 p.7](https://www.ercot.com/files/docs/2014/03/07/ros_jan_6_eea_report.pdf) |
| ERS deployed, Feb 15, 2021 | ERS-30 847.15 MW; ERS-10 51.6 MW | [TEST-ONLY] | [FERC-NERC-2021 p.134](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| ERS sizes stated in 2021 | ERS-30 ~820 MW; ERS-10 ~820 MW | [TEST-ONLY] (describes pre-2021 state) | [EEA-2021](https://www.ercot.com/files/docs/2021/06/11/2021_EEA_Overview_Final.pdf) |

---

## 7. System size

### 7.1 Winter 2010/11

| Fact | Value | Tag | Source |
|---|---|---|---|
| Total installed | ~84,400 MW with full wind nameplate (2011); ~79,700 MW wind-adjusted at 8 AM Feb 2, 2011 | [CALIBRATION-SAFE] | [FERC-2011 pp.79, 179](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Fuel mix of installed capacity (2009, ERCOT annual report) | gas 59%, coal 22%, wind 11%, nuclear 6%, hydro + biomass 2% | [CALIBRATION-SAFE] | [FERC-2011 p.25 fn.28](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Derived MW (59/22/11/6/2% × 84,400) | gas ~49,800; coal ~18,600; wind 9,321 (actual nameplate); nuclear ~5,100; other ~1,700 | [CALIBRATION-SAFE] (derived by us; not a published table) | derived from the FERC-2011 rows above |
| 2009 energy mix | gas 42%, coal 37%, nuclear 14%, wind 6%, other 1% | [CALIBRATION-SAFE] | [FERC-2011 p.25 fn.28](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Units / transmission | >550 units; 40,500 miles | [CALIBRATION-SAFE] | [FERC-2011 p.24](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Customers served | ~23 million people; 85% of Texas load; 75% of land area | [CALIBRATION-SAFE] | [FERC-2011 Glossary p.9](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| 2011 summer peak | 68,294 MW (Aug 3, 2011, FERC); ERCOT settled 68,379 MW | [CALIBRATION-SAFE] | [FERC-2011 p.24](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf); [ERCOT records](https://www.ercot.com/static-assets/data/news/content/a-peak-demand/all-time-records.htm) |
| Texas population | 25,145,561 (2010 Census) | [CALIBRATION-SAFE] | [Census QuickFacts](https://www.census.gov/quickfacts/table/POP010210/48,00) |

### 7.2 Winter 2020/21 (pre-storm)

| Fact | Value | Tag | Source |
|---|---|---|---|
| Customers | >26 million people; ~8 million ESIIDs (premises) in competitive-choice areas (75% of load); 90% of Texas load | [CALIBRATION-SAFE] | [FACT-2020](https://www.ercot.com/files/docs/2020/11/10/ERCOT_Fact_Sheet_11.10.20.pdf) |
| Units / transmission | 680+ generating units (excluding private-use networks); 46,500+ miles | [CALIBRATION-SAFE] | [FACT-2020](https://www.ercot.com/files/docs/2020/11/10/ERCOT_Fact_Sheet_11.10.20.pdf) |
| Installed wind / solar / storage (Oct 2020) | 24,976 MW / 3,854 MW / 185 MW | [CALIBRATION-SAFE] | [FACT-2020](https://www.ercot.com/files/docs/2020/11/10/ERCOT_Fact_Sheet_11.10.20.pdf) |
| Coal / nuclear | 13,630 MW / 5,153 MW | [CALIBRATION-SAFE] | [CDR-2020 Winter Fuel Types](https://www.ercot.com/files/docs/2020/12/16/CapacityDemandandReservesReport_Dec2020.pdf) |
| Gas (winter rating incl. private-use networks) | 56,102 MW (winter 2021/22 column, the first in the Dec 2020 CDR) | [CALIBRATION-SAFE] | [CDR-2020](https://www.ercot.com/files/docs/2020/12/16/CapacityDemandandReservesReport_Dec2020.pdf) |
| CDR winter capacity contribution, total | 85,281 MW (wind credited at 43/32/19%, solar at 7%) | [CALIBRATION-SAFE] | [CDR-2020](https://www.ercot.com/files/docs/2020/12/16/CapacityDemandandReservesReport_Dec2020.pdf) |
| SARA winter 2020/21 total resources | 82,513 MW | [CALIBRATION-SAFE] | [SARA-W2021](https://www.ercot.com/files/docs/2020/11/05/SARA-FinalWinter2020-2021.pdf) via [UT-2021 p.15](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Records before 2021 | summer 74,820 MW (Aug 12, 2019); winter 65,915 MW (Jan 17, 2018); 2019 energy use 384 TWh | [CALIBRATION-SAFE] | [FACT-2020](https://www.ercot.com/files/docs/2020/11/10/ERCOT_Fact_Sheet_11.10.20.pdf); [UT-2021 p.15](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| Texas population | 28,995,881 (Census July 1, 2019 estimate) | [CALIBRATION-SAFE] | [Texas Demographic Center 2020 presentation (Census 2019 estimates)](https://www.dot.state.tx.us/ttf/pdf/dr-lloyd-potter-ttf20.pdf) |
| Installed by fuel at Uri (ERCOT, Feb 2021) | gas 51,667 (47.45%); wind 31,390 (28.83%); coal 13,630 (12.52%); solar 6,177 (5.67%); nuclear 5,153 (4.73%); stated total 107,514 MW | [TEST-ONLY] | [ERCOT-Board-0224 slide 7](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf) |
| Installed nameplate (FERC-NERC basis) | 123,057 MW; fleet 52% gas, 25% wind, 12% coal, 4% nuclear, 5% solar, 1% storage/other | [TEST-ONLY] | [FERC-NERC-2021 pp.22, 125](https://www.nerc.com/pa/rrm/ea/Documents/February_2021_Cold_Weather_Report.pdf) |
| Texas population | 29,145,505 (2020 Census, released Apr 2021) | [TEST-ONLY] | [Census / Wikipedia summary](https://en.wikipedia.org/wiki/Demographics_of_Texas) |

---

## 8. Costs for the agent's build-phase options

### 8.1 Winterization

| Item | Value | Tag | Source |
|---|---|---|---|
| Basic insulation + heat tracing, gas/CC unit | $50,000-$500,000 per unit (2011$), depending on age and design temperature | [CALIBRATION-SAFE] | [FERC-2011 p.179](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Independent engineering cold-weather assessment | $25,000-$150,000 per gas unit | [CALIBRATION-SAFE] | [FERC-2011 p.179 fn.236](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| Cooling-tower bypass / variable-speed fan motors | $150,000-$500,000 | [CALIBRATION-SAFE] | [FERC-2011 p.180](https://www.ferc.gov/sites/default/files/2020-05/08-16-11-report.pdf) |
| 1989 utility corrective actions (aggregate) | < $3 million | [CALIBRATION-SAFE] (PUCT 1990) | [UT-2021 p.71](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| ERCOT weatherization spot checks | ~80 units/year (no enforceable standard before 2021) | [TEST-ONLY] (describes pre-2021 state) | [ERCOT-Board-0224 slide 17](https://www.ercot.com/files/docs/2021/02/24/2.2_REVISED_ERCOT_Presentation.pdf) |
| All 162 Texas gas plants (inflation-adjusted 2011 estimate) | up to $95 million total | [TEST-ONLY] | [DALLASFED](https://www.dallasfed.org/research/economics/2021/0415) |
| Wind turbine factory blade heating | ~$400,000 per turbine (retrofit "infeasible"); Texas has ~13,000 turbines | [TEST-ONLY] | [DALLASFED](https://www.dallasfed.org/research/economics/2021/0415) |
| Gas well winterization | $20,000-$50,000 per well; $85-200 million per year statewide | [TEST-ONLY] | [DALLASFED](https://www.dallasfed.org/research/economics/2021/0415) |
| Value of lost load | firms $6,733/MWh; households $117.60/MWh; break-even winterization ≤ $430M/yr (10% of the $4.3B outage cost, once-a-decade event) | [TEST-ONLY] | [DALLASFED](https://www.dallasfed.org/research/economics/2021/0415) |

### 8.2 Grid battery storage (2018-2020)

| Item | Value | Tag | Source |
|---|---|---|---|
| US average utility-scale battery cost, energy basis | $2,152/kWh (2015) to $625/kWh (2018) | [CALIBRATION-SAFE] (EIA, Oct 23, 2020) | [EIA Today in Energy 45596](https://www.eia.gov/todayinenergy/detail.php?id=45596) |
| Lazard LCOS v5.0, wholesale 100 MW / 400 MWh Li-ion, capital | $225-$469/kWh; $898-$1,874/kW | [CALIBRATION-SAFE] (Nov 2019) | [Lazard LCOS 5.0](https://www.lazard.com/media/43hbgpqr/lazards-levelized-cost-of-storage-version-50-vf.pdf) |
| Same, levelized | $165-$305/MWh; $231-$428/kW-yr | [CALIBRATION-SAFE] | same |
| Lazard 100 MW / 100 MWh and 200 MWh | capital $280-$513/kWh (1 h); $244-$490/kWh (2 h) | [CALIBRATION-SAFE] | same |
| NREL 2020 projection, 4-h battery in 2030 | $144 / $208 / $293 per kWh (low/mid/high) | [CALIBRATION-SAFE] (NREL/TP-6A20-75385, Jun 2020) | [NREL research hub record](https://research-hub.nrel.gov/en/publications/cost-projections-for-utility-scale-battery-storage-2020-update/) |
| ERCOT installed storage (Oct 2020) | 185 MW (treated as regulation, no capacity credit in CDR) | [CALIBRATION-SAFE] | [FACT-2020](https://www.ercot.com/files/docs/2020/11/10/ERCOT_Fact_Sheet_11.10.20.pdf); [CDR-2020](https://www.ercot.com/files/docs/2020/12/16/CapacityDemandandReservesReport_Dec2020.pdf) |

### 8.3 Demand response

| Item | Value | Tag | Source |
|---|---|---|---|
| ERS/EILS annual spending cap | $50 million/yr (raised from $20M in 2007) | [CALIBRATION-SAFE] | [ERCOT ERS 2012 annual report](https://www.ercot.com/files/docs/2013/04/04/ercot_ers_2012_annual_report.pdf) |
| ERS average cost | $5.78-$7.73 per MW per hour ("recent years", 2016 report) | [CALIBRATION-SAFE] | [ERCOT ERS 2016 annual report](https://www.ercot.com/files/docs/2017/03/23/ERS_2016_Annual_Report_final.doc) |
| ERS offer cap | $80/MW/h | [CALIBRATION-SAFE] (2013 procurement methodology) | [ERS procurement methodology](https://www.ercot.com/files/docs/2013/10/08/07._ers_procurement_methodology_v0_1.doc) |
| Derived annual cost per MW if held all 8,760 h | ~$51,000-$68,000 per MW-year | [CALIBRATION-SAFE] (derived by us: $5.78-7.73 × 8,760) | derived |
| Price-responsive retail DR (summer 4CP) | ERCOT estimated >4,000 MW; >100,000 accounts on real-time/index pricing and >94,000 on peak rebates in 2020 | [TEST-ONLY] (2021 report) | [UT-2021 p.37](https://energy.utexas.edu/sites/default/files/UTAustin%20(2021)%20EventsFebruary2021TexasBlackout%2020210714.pdf) |
| ERS cap after Uri | $75 million (+$25M for renewals), applied from Dec 2022 | [TEST-ONLY] | [PUCT filing](https://interchange.puc.texas.gov/Documents/53493_41_1227758.PDF) |

---

## Conflicts between sources (flagged)

| Item | Values | Notes |
|---|---|---|
| Uri winter peak, Feb 14, 2021 | 69,871 (FERC-NERC); 69,812 (ERCOT Elliott report); 69,692 (ERCOT Feb 2021 monthly); 69,222 (ERCOT board slide); 69,150 (ERCOT preliminary, 6-7 PM); 69,215 MWh (EIA hourly) | Hourly vs instantaneous, plus settlement revisions. Use 69,871 MW as the FERC-NERC value. |
| Uri peak unavailable generation | 52,277 MW (Feb 24 board, 48.6% of 107,514); 52,037 MW (Apr 27 RFI update, Feb 16 8 AM); ~51,173 MW (Utility Dive's report of a later ERCOT analysis; not verified in an ERCOT document); 47,744 total / 45,932 unplanned (FERC-NERC, Feb 15 1:05 PM, 123,057 MW base); ~34,000 MW average (expected-capacity basis) | Different capacity bases and timestamps. ERCOT's 107,514 MW total does not equal its own fuel figures (sum 108,017). |
| Uri minimum frequency | 59.302 Hz (~1:55 AM; ERCOT, UT); 59.304 Hz (1:54 AM; FERC-NERC) | 2 mHz difference. |
| Uri installed wind | 31,390 MW (ERCOT board) vs ~24,962 (SARA) / 24,976 (Oct 2020 fact sheet) | Board figure likely includes planned or partial resources; treat with caution. |
| Uri units affected | 356 (ERCOT, 2011 method); ~585 (UT); 1,045 for the whole event area (FERC-NERC) | Counting rules differ. |
| Dallas low in Uri | -2 °F (ERCOT); "8 °F" and "4 °F on Feb 15" (FERC-NERC narrative) | NWS DFW record low was -2 °F on Feb 16; FERC quotes other stations or days. |
| Customers without power, Uri | ~4.5 million ("people" in FERC-NERC; "customers" in UT); 4,893,204 DOE peak (incl. storm damage); ">4 million" (DOE); ~4.3 million (PowerOutage.us via Statista) | Different definitions and timestamps. |
| Uri deaths | 246 (DSHS final) vs 210 (DSHS Jul 2021, FERC-NERC) vs 151 (DSHS May 2021) vs 702 (BuzzFeed excess deaths, 426-978) | Use 246 as official; 702 as an upper estimate. |
| Uri economic cost | $80-130B (Dallas Fed) vs $195-295B (Perryman) | Different methods. |
| EEA 3 threshold before and at Uri | 1,000 MW (2016 POB, 2019 one-pager); 1,430 MW (applied Feb 2021 per FERC-NERC); 1,375 MW "enter EEA 3" / shed at 1,000 MW (ERCOT May 2021); 1,500 MW (from Nov 2023) | ERCOT changed the trigger between 2019 and Feb 2021; the exact effective date of 1,430 MW was not found in pre-2021 sources. |
| Jan 17, 2018 winter record | 65,915 MW (ERCOT/SARA/UT) vs 65,750 MW (FERC-NERC 2021; ERCOT preliminary) vs 65,731 MW (ENGIE) | Settlement revision. |
| Elliott peak | 74,525 (final) vs 74,427 / 73,910 / 74,100 | Preliminary vs settled. |
| Aug 2023 record | 85,508 (settled) vs 85,435 / 85,464 (preliminary) | Settlement revision. |
| 2011 units affected | 193 (FERC, Feb 1-2); 210 (FERC, Feb 1-4); 225 (Texas RE) | Different windows and counting. |
| 2011 peak forced outage | 14,702 MW (FERC) vs 14,855 MW (Texas RE) | Similar. |
| 2011 load shed | 4,000 MW directed; 4,947.9 MW max actual; ~4,900 MW (8.7% of peak, FERC; UT says 8.3%); 5,411.6 MW non-coincident sum (used as "max" in FERC-NERC 2021 Fig.18) | Use 4,000 directed / ~4,950 actual. |
| 2011 winter peak | 56,480 MW (Feb 2, 7:15 PM) and 56,334 MW (FERC table); Feb 10: 57,915 MW instantaneous (FERC) vs 57,265 MW settled hourly (ERCOT) | Instantaneous vs hourly. |
| 2011 lowest frequency | 59.576 Hz (FERC) vs 59.58 Hz (ERCOT 2021 table) | Rounding. |
| Dec 1989 load shed | 1,710 MW total (PUCT/FERC) vs "500 MW" (ERCOT 2021 overview, the system-wide block only); date Dec 23 (FERC/PUCT) vs Dec 22 (ERCOT 2019 one-pager) | Use 1,710 MW on Dec 23. |
| Dec 1989 other | units 56+ (FERC) vs 86 (UT); load shed 4.5% (FERC) vs 4.3% (UT) of peak; net reduction 11,809 MW (FERC) vs ~13,000 (UT); Dallas wind chill -12 °F (FERC table) vs -35 °F (FERC narrative, statewide) | |
| 2011 summer peak | 68,294 MW (FERC) vs 68,379 MW (ERCOT settled) | |
| Load Resource share of RRS | 50% (2011) vs 60% (2020 methodology, 2021) | A real rule change, not an error. |
| Uri automatic UFLS | ~276 MW (FERC-NERC) vs ~200 MW (UT) | |
| Frequency-related generator outages | ~1,800 MW at 2 AM Feb 15 (UT) vs 1,262 MW at Feb 16 peak (ERCOT) | Different timestamps. |

---

## Simulator calibration targets (CALIBRATION-SAFE only)

These are the numbers a pre-2021 calibration run should reproduce, or use as inputs.

**Feb 2011 replay (primary calibration event):**
- Dallas low ~13 °F, wind chill ~-6 °F; ~4 days below freezing; DFW 101 consecutive hours at or below freezing.
- Fleet ~79,700 MW (wind-adjusted), 9,321 MW wind nameplate, 11,566-12,413 MW scheduled outages.
- Forced outages: 6,022 MW by midnight Feb 1, rising to a **14,702 MW peak net forced outage at 6:12 AM Feb 2** (27,115 MW total unavailable, ~1/3 of the fleet); 193 units / 29,729 MW gross cumulative by end of Feb 2.
- Causes (Feb 1-5): weather 22,805 MW (frozen sensing lines 15,255), non-weather 14,386 MW, gas supply 1,282 MW. Normal forced-outage background ~3,200 MW/day (range 900-6,300).
- Demand absent shedding ~59,000 MW (forecast 57,436 MW); actual peak ~56,334-56,480 MW.
- EEA sequence: EEA 2A at 5:20 AM, EEA 3 at 5:43 AM; shed orders 1,000 + 1,000 + 2,000 = **4,000 MW** (5:43, 6:04, 6:23); ~4,950 MW actual max; duration 7 h 24 min.
- **Minimum frequency 59.576 Hz**; no UFLS; minimum reserves 447 MW.
- Gas: US production -5.55 Bcf/d (-9.4%); TX/NM -4.36 Bcf/d; blackouts caused 27-29% of basin production losses.
- 3.2 million customers affected; $3,000/MWh price cap reached.

**Dec 1989 replay:** peak 38,300 MW; 16,805 MW gross / 11,809 MW net capacity lost; frequency low 59.65 Hz; 1,710 MW firm shed over 5 h 47 min; Dallas -1 °F.

**Jan 6, 2014 replay:** 9,355 MW lost before EEA (3,541 MW weather); EEA 2 without firm shed; minimum PRC 1,344 MW; Load Resources 1,082 MW + ERS 620 MW deployed.

**Other safe anchors:** May 2003 automatic UFLS shed 1,549 MW after a double nuclear trip; Apr 2006 1,000 MW rotating outages; Feb 2003 net 2,300 MW gas-curtailment loss; Jan 17, 2018 winter peak 65,915 MW; Aug 2019 EEA 1 at PRC ~2,156-2,245 MW.

**Operating parameters:** 60 Hz nominal; UFLS 59.3 / 58.9 / 58.5 Hz shedding 5 / +10 / +10% (cumulative 25%); Load Resources trip at 59.7 Hz; generator UF trips allowed after 9 min at ≤59.4 Hz, 30 s at ≤58.4 Hz, 2 s at ≤58.0 Hz, instantly at ≤57.5 Hz; RRS minimum 2,300 MW (N-2), LR share ≤60% (2020), PFR RRS ≥1,150 MW; N-1 1,354 MW (2011), N-2 2,750 MW (2018) / 2,805 MW (2020); critical inertia 94 GW·s (computed) / 100 GW·s (operating limit); annual minimum inertia 130-152 GW·s (2013-2017); typical ~150-380 GW·s; EEA 1/2/3 at PRC 2,300 / 1,750 / 1,000 MW (2016-2019 procedure), EEA 3 allowed below 59.8 Hz and mandatory below 59.5 Hz; PRC Advisory < 3,000 MW, Watch < 2,500 MW; DC ties ~1,090 MW (2011).

**Pre-storm 2020/21 outlook (inputs only):** forecast peak 57,699 MW; extreme 67,208 MW; resources 82,513 MW; expected thermal outages 8,616 MW (extreme 13,953 MW); expected winter wind 7,070 MW (low 1,791 MW) of ~24,962-24,976 MW nameplate; solar 3,854 MW; storage 185 MW; coal 13,630 MW; nuclear 5,153 MW; gas ~56,102 MW (winter rating incl. private-use networks); >26 million people; ~8 million competitive ESIIDs; population ~29.0 million (2019 est.).

**Costs (2011-2020 dollars):** winterization $50k-500k per gas/CC unit, engineering study $25k-150k, cooling tower fixes $150k-500k; battery $625/kWh average (2018, EIA); $225-469/kWh or $898-1,874/kW for 4-h wholesale (Lazard 2019); ERS ~$5.78-7.73/MW-h, $50M/yr cap.

## Evaluation reference (TEST-ONLY: "what actually happened")

**Uri (Feb 2021), ERCOT:**
- Winter peak **69,871 MW** (Feb 14, HE 8 PM); demand absent shedding **76,819 MW** (ERCOT backcast).
- Peak unavailable generation **52,037 MW** (Feb 16, 8 AM; ERCOT revised; first estimate 52,277 MW = 48.6% of 107,514 MW). FERC basis: 45,932 MW unplanned + 1,812 planned = 47,744 MW (Feb 15, 1:05 PM). Weather 53%, existing 15%, equipment 14%, fuel 12%, transmission 3%, frequency 2%. Average 34,000 MW unavailable (expected-capacity basis) for 2+ days.
- EEA 1 00:15, EEA 2 01:07, EEA 3 01:20 Feb 15; normal operations 10:35 AM Feb 19.
- **Frequency:** below 59.4 Hz from ~1:51 AM for **4 min 23 s**; minimum **59.302 Hz** (FERC: 59.304 Hz at 1:54); 9-minute relay limit means **4 min 37 s of margin** (ERCOT board timeline; KUT, Feb 24, 2021); ~17,000 MW would have tripped; ~200-276 MW of automatic UFLS operated.
- **Load shed:** first 1,000 MW at 1:20 AM; 10,500 MW by 2:00 AM; **maximum 20,000 MW by ~7-7:15 PM Feb 15**; ~14,000 MW average; **70.5 h** (to ~11:55 PM Feb 17; last orders cancelled 12:42 AM Feb 18).
- **~4.5 million** customers/people without power (DOE peak 4.89M incl. storm damage); average outage 42 h (survey).
- **Deaths:** 246 official (DSHS); 702 excess-death estimate (426-978).
- **Cost:** $80-130B (Dallas Fed); $195-295B (Perryman).
- Gas: ERCOT gas fuel-limited outages 3,500 to 6,700 MW; cumulative gas supply derates 9,323 MW; TX/OK/LA production down ~21 Bcf/d (>50%).
- Wind output averaged ~3,100 MW during the shed (low ~500 MW).

**Elliott (Dec 2022):** peak **74,525 MW**; max outages 19,885 MW (~4,500 MW cold/fuel related); minimum PRC 4,052 MW; **no EEA, no load shed**.

**Aug-Sep 2023:** record **85,508 MW** (Aug 10); **11** conservation appeals; **Sept 6 EEA 2** at 7:25 PM; frequency low **59.769 Hz**; no controlled outages; EEA 1 at 8:27 PM, normal at 8:37 PM.
