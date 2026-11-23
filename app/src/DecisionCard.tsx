// 내가 만든 부품 DecisionCard의 화면 쪽 구현. 약속(이름과 속성)은 shared/decision-card.ts에 있다.
// 에이전트는 이 부품의 이름과 속성만 알고, 어떻게 생겼는지는 이 파일이 정한다.
import {createComponentImplementation} from '@a2ui/react';
import {Catalog} from '@a2ui/web_core';

import {DECISION_CATALOG_ID, DecisionCardApi} from '../shared/decision-card';

export const DecisionCard = createComponentImplementation(DecisionCardApi, ({props}) => {
  const options = props.options ?? [];
  return (
    <div className="decision">
      <div className="decision-kicker">결정 요청 · 내 부품(DecisionCard)</div>
      <h3 className="decision-title">{String(props.title ?? '')}</h3>
      <p className="decision-ask">{String(props.ask ?? '')}</p>
      {props.why ? <p className="decision-why">{String(props.why)}</p> : null}
      <ol className="decision-options">
        {options.map((option, index) => (
          <li key={index} className={option.recommended ? 'decision-option recommended' : 'decision-option'}>
            <div className="decision-option-head">
              <span className="decision-option-label">{String(option.label ?? '')}</span>
              {option.recommended ? <span className="decision-badge">추천</span> : null}
            </div>
            <dl>
              <dt>고르면</dt>
              <dd>{String(option.does ?? '')}</dd>
              {option.pros ? (
                <>
                  <dt>장점</dt>
                  <dd>{String(option.pros)}</dd>
                </>
              ) : null}
              {option.cons ? (
                <>
                  <dt>단점</dt>
                  <dd>{String(option.cons)}</dd>
                </>
              ) : null}
            </dl>
            <button type="button" className="decision-pick" onClick={() => option.action?.()}>
              이 안으로 진행
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
});

export const decisionCatalog = new Catalog(DECISION_CATALOG_ID, '1.0', [DecisionCard]);
