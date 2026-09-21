'use strict';
// Synchronous transaction contract for the synchronous paper engine. A future
// asynchronous PostgreSQL adapter needs an awaited engine boundary; it is not wired here.
const clone=x=>structuredClone(x);
function createPaperTradingRepository({mode='MEMORY_ONLY'}={}) {
  if(mode!=='MEMORY_ONLY')throw Error('PERSISTENT_UNAVAILABLE');
  let state=null,events=new Map(),transaction=null;
  return Object.freeze({persistence:'MEMORY_ONLY',
    loadState:()=>clone(state),hasProcessedEvent:eventId=>events.has(eventId),
    begin(expectedVersion){if(transaction||(state?.stateVersion??null)!==expectedVersion)throw Error('STATE_CONFLICT');transaction={state:clone(state),events:new Map(events)};},
    saveState(next){if(!transaction)throw Error('TRANSACTION_REQUIRED');transaction.state=clone(next);},
    saveEvent(event){if(!transaction||transaction.events.has(event.eventId))throw Error('DUPLICATE_EVENT');transaction.events.set(event.eventId,clone(event));},
    commit(){if(!transaction)throw Error('TRANSACTION_REQUIRED');state=transaction.state;events=transaction.events;transaction=null;},
    rollback(){transaction=null;}
  });
}
module.exports={createPaperTradingRepository};
