import { SaxonJsSchematronValidationReportGateway } from '../gateways/saxon-js';
import { createPresenter } from '../presenter';
import { ValidateSchematronUseCase } from '../use-cases/validate-ssp-xml';
import { renderApp } from '../views';

type BrowserContext = {
  debug: boolean;
};

export default ({ debug }: BrowserContext) => {
  const useCases = {
    validateSchematron: ValidateSchematronUseCase({
      generateSchematronValidationReport:
        SaxonJsSchematronValidationReportGateway({
          // The npm version of saxon-js is for node; currently, we load the
          // browser version via a script tag in index.html.
          SaxonJS: (window as any).SaxonJS,
        }),
    }),
  };
  const presenter = createPresenter({ useCases, debug });
  renderApp(document.getElementById('root') as HTMLElement, presenter);

  // Hot Module Replacement (HMR) - Remove this snippet to remove HMR.
  // Learn more: https://snowpack.dev/concepts/hot-module-replacement
  if (import.meta.hot) {
    import.meta.hot.accept();
  }
};
