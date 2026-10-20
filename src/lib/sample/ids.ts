/**
 * Stable, readable ids for the sample workspace, shared across its modules so every cross-reference
 * (deal → person, draft span → evidence, angle → claim) is checked by the compiler.
 */

export const DOMAIN = {
  ledgerline: "ledgerline.example",
  northwind: "northwind.example",
  lumenwire: "lumenwire.example",
  rowanstack: "rowanstack.example",
  saltmarsh: "saltmarsh.example",
  fernwick: "fernwick.example",
  driftglass: "driftglass.example",
  bramblecast: "bramblecast.example",
  ashgrove: "ashgrove.example",
  glassmoor: "glassmoor.example",
  hollowpine: "hollowpine.example",
  cinderpath: "cinderpath.example",
  quayside: "quayside.example",
  wrenfield: "wrenfield.example",
  quillfeather: "quillfeather.example",
  ironvale: "ironvale.example",
} as const;

export const PERSON = {
  dana: "per_dana_okafor",
  marcus: "per_marcus_lindqvist",
  sofia: "per_sofia_reyes",
  ethan: "per_ethan_brooks",
  grace: "per_grace_liu",
  nadia: "per_nadia_haddad",
  tom: "per_tom_becker",
  leo: "per_leo_marchetti",
  owen: "per_owen_park",
  mei: "per_mei_tanaka",
  jordan: "per_jordan_ellis",
  rafael: "per_rafael_ortiz",
  lena: "per_lena_fischer",
  theo: "per_theo_grant",
  sam: "per_sam_whitlock",
  ava: "per_ava_whitman",
  ben: "per_ben_adler",
} as const;

export const DEAL = {
  northwind: "deal_northwind",
  lumenwire: "deal_lumenwire",
  rowanstack: "deal_rowanstack",
  saltmarsh: "deal_saltmarsh",
  wrenfield: "deal_wrenfield",
  quillfeather: "deal_quillfeather",
} as const;

export const MEETING = {
  lumenwireToday: "mtg_lumenwire_checkin",
  lumenwireKickoff: "mtg_lumenwire_kickoff",
  northwindYesterday: "mtg_northwind_followup",
  northwindDiscovery: "mtg_northwind_discovery",
  northwindDeepDive: "mtg_northwind_deepdive",
  saltmarshDiscovery: "mtg_saltmarsh_discovery",
  rowanstackProposal: "mtg_rowanstack_proposal",
  quillfeatherTechnical: "mtg_quillfeather_technical",
} as const;

export const PACKAGE = {
  fernwickCold: "pkg_fernwick_cold",
  driftglassCold: "pkg_driftglass_cold",
  bramblecastLinkedin: "pkg_bramblecast_linkedin",
  ashgroveIntro: "pkg_ashgrove_intro",
} as const;

export const CLAIM = {
  credential: "clm_tollgate_credential",
  designPartner: "clm_design_partner_close",
  catchRate: "clm_catch_rate",
} as const;

export const POV = {
  blackBox: "pov_script_black_box",
  lateEvents: "pov_late_events",
  consumption: "pov_consumption_close",
} as const;

export const ASSET = {
  onePager: "ast_one_pager",
  dpTerms: "ast_design_partner_terms",
  security: "ast_security_posture",
} as const;

export const THEME = {
  close: "vt_close_in_hours",
  leakage: "vt_catch_leakage",
  audit: "vt_audit_trail",
} as const;

export const CRITERION = {
  usage: "icp_usage_pricing",
  size: "icp_size",
  warehouse: "icp_warehouse_usage",
  funded: "icp_funded",
  finance: "icp_finance_owner",
  pricingChange: "icp_pricing_change",
} as const;

export const PERSONA = {
  champion: "psn_controller",
  buyer: "psn_finance_leader",
  technical: "psn_data_lead",
} as const;

export const CONNECTOR = {
  claire: "con_claire_donovan",
  rohan: "con_rohan_mehta",
  ava: "con_ava_whitman",
  ines: "con_ines_duarte",
} as const;

export const EVENT = {
  dinner: "evt_nyc_dinner",
  roundtable: "evt_roundtable",
} as const;

export const RUN = {
  brief: "run_brief_today",
  prep: "run_prep_lumenwire",
  composeFernwick: "run_compose_fernwick",
  debrief: "run_debrief_northwind",
  dossierFernwick: "run_dossier_fernwick",
  enrich: "run_enrich_signals",
  discovery: "run_discovery",
  dossierNorthwind: "run_dossier_northwind",
  dossierDriftglass: "run_dossier_driftglass",
  composeDriftglass: "run_compose_driftglass",
  network: "run_network",
  review: "run_review",
  dinner: "run_dinner_plan",
  foundation: "run_foundation",
} as const;
