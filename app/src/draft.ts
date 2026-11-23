// 스트림으로 받은 A2UI 메시지를, 사람이 고쳐 볼 수 있는 한 벌의 메시지로 모은다.
//
// 공식 SDK의 스트림은 형식에 따라 다르게 내보낸다.
// - JSON 형식: 같은 updateComponents를 점점 길게 다시 보낸다(누적).
// - Express 형식: 부품을 하나씩 따로 보낸다(조각).
// 그래서 "마지막 메시지만 남기기"로는 Express에서 부품이 빠진다. 부품은 id별로 합친다.

type Message = Record<string, any>;

interface SurfaceDraft {
  create: Message;
  components: Map<string, Message>;
  data: Map<string, Message>;
}

export class DraftBuilder {
  private surfaces = new Map<string, SurfaceDraft>();
  private others: Message[] = [];

  reset() {
    this.surfaces.clear();
    this.others = [];
  }

  add(incoming: unknown[]) {
    for (const message of incoming as Message[]) {
      const type = Object.keys(message).find(key => key !== 'version') ?? '';
      const body = message[type] ?? {};
      const surfaceId: string | undefined = body.surfaceId;

      if (type === 'createSurface' && surfaceId) {
        const {components, ...rest} = body;
        const previous = this.surfaces.get(surfaceId);
        const draft: SurfaceDraft = previous ?? {create: message, components: new Map(), data: new Map()};
        draft.create = {...message, createSurface: rest};
        for (const component of components ?? []) draft.components.set(component.id, component);
        this.surfaces.set(surfaceId, draft);
      } else if (type === 'updateComponents' && surfaceId && this.surfaces.has(surfaceId)) {
        const draft = this.surfaces.get(surfaceId)!;
        for (const component of body.components ?? []) draft.components.set(component.id, component);
      } else if (type === 'updateDataModel' && surfaceId && this.surfaces.has(surfaceId)) {
        this.surfaces.get(surfaceId)!.data.set(body.path ?? '/', message);
      } else if (type === 'deleteSurface' && surfaceId) {
        this.surfaces.delete(surfaceId);
      } else {
        this.others.push(message);
      }
    }
  }

  /** 화면마다 createSurface, 부품 전체를 담은 updateComponents 하나, 데이터 메시지 순서로 돌려준다. */
  toMessages(): Message[] {
    const out: Message[] = [];
    for (const [surfaceId, draft] of this.surfaces) {
      out.push(draft.create);
      if (draft.components.size > 0) {
        out.push({
          version: draft.create.version,
          updateComponents: {surfaceId, components: Array.from(draft.components.values())},
        });
      }
      out.push(...draft.data.values());
    }
    out.push(...this.others);
    return out;
  }
}
