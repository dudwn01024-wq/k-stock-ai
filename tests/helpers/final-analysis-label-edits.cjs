'use strict';
module.exports={
  "frontend/src/ExpandedCandidateCard.jsx": [
    [
      "import {recommendationDataDates} from './recommendationDataDates.js';",
      "import {recommendationDataDates} from './recommendationDataDates.js';\nimport {strategyExplanation} from './utils/strategyExplanation.js';"
    ],
    [
      "CHASE_CAUTION:'추격 주의'",
      "CHASE_CAUTION:'가격 추격 주의'"
    ],
    [
      "기존 추천 점수",
      "분석 조건 점수"
    ],
    [
      "추천 이유 · 통과 조건",
      "분석 근거 · 충족 조건"
    ],
    [
      "aria-label=\"추천 조건\"",
      "aria-label=\"분석 조건\""
    ],
    [
      "{riskReward.reason}",
      "{strategyExplanation(riskReward.reason)}"
    ]
  ],
  "frontend/src/CandidateOverview.jsx": [
    [
      "? '추격 주의' : null",
      "? '가격 추격 주의' : null"
    ],
    [
      "CHASE_CAUTION:'추격 주의'",
      "CHASE_CAUTION:'가격 추격 주의'"
    ],
    [
      "<span>추격 주의 <strong>",
      "<span>가격 추격 주의 <strong>"
    ],
    [
      "후보 점수 {item.score",
      "분석 조건 점수 {item.score"
    ],
    [
      "{summary.risk}",
      "{strategyExplanation(summary.risk)}"
    ]
  ],
  "frontend/src/App.jsx": [
    [
      "최우선·추격 주의 후보",
      "최우선·가격 추격 주의 후보"
    ],
    [
      "🟠 추격 주의",
      "🟠 가격 추격 주의"
    ],
    [
      "추격 주의 {recommendationData",
      "가격 추격 주의 {recommendationData"
    ],
    [
      "조건 우수 후보와 추격 주의 후보",
      "조건 우수 후보와 가격 추격 주의 후보"
    ],
    [
      "ENTRY_CANDIDATE: '분석 조건 충족', WAIT:",
      "ENTRY_CANDIDATE: '분석 조건 충족', CHASE_CAUTION: '가격 추격 주의', WAIT:"
    ]
  ],
  "frontend/src/RecommendationHistory.jsx": [
    [
      "CHASE_CAUTION:'추격 주의'",
      "CHASE_CAUTION:'가격 추격 주의'"
    ]
  ],
  "frontend/src/RecommendationOutcomes.jsx": [
    [
      "CHASE_CAUTION:'추격 주의'",
      "CHASE_CAUTION:'가격 추격 주의'"
    ]
  ],
  "frontend/src/utils/strategyExplanation.js": [
    [
      "    .replace(/추격매수/g, '가격 추격');",
      "    .replace(/추격매수/g, '가격 추격')\n    .replace(/(?:가격\\s+)?추격 주의/g, '가격 추격 주의')\n    .replace(/추천 이유 · 통과 조건/g, '분석 근거 · 충족 조건')\n    .replace(/(?:기존 )?추천 점수/g, '분석 조건 점수')\n    .replace(/추천 이유/g, '분석 근거');"
    ]
  ]
};
