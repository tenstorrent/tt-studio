"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import axios from "axios";
import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Button } from "./ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./ui/form";
import { Step, Stepper, useStepper } from "./ui/stepper";
import UploadDialog from "./UploadDialog";
import CustomToaster, { customToast } from "./CustomToaster";

const dockerAPIURL = "/docker-api/";
const modelAPIURL = "/models-api/";
const deployUrl = `${dockerAPIURL}deploy/`;
const getModelsUrl = `${dockerAPIURL}get_containers/`;
const getWeightsUrl = (modelId: string) =>
  `${modelAPIURL}model_weights/?model_id=${modelId}`;

interface SecondStepFormProps {
  addCustomStep: () => void;
  addFineTuneStep: () => void;
  removeDynamicSteps: () => void;
}

interface Model {
  id: string;
  name: string;
}

interface Weight {
  weights_id: string;
  name: string;
}

export default function StepperDemo() {
  const [steps, setSteps] = useState([
    { label: "Step 1", description: "Model Selection" },
    { label: "Step 2", description: "Model Weight Selection" },
    { label: "Final Step", description: "Deploy Model" },
  ]);

  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedWeight, setSelectedWeight] = useState<string | null>(null);
  const [customWeight, setCustomWeight] = useState<Weight | null>(null);

  const addCustomStep = () => {
    setSteps((prevSteps) => {
      const customStepIndex =
        prevSteps.findIndex((step) => step.label === "Step 2") + 1;
      const customStep = {
        label: "Custom Step",
        description: "Upload Custom Weights",
      };
      if (!prevSteps.some((step) => step.label === "Custom Step")) {
        return [
          ...prevSteps.slice(0, customStepIndex),
          customStep,
          ...prevSteps.slice(customStepIndex),
        ];
      }
      return prevSteps;
    });
  };

  const addFineTuneStep = () => {
    setSteps((prevSteps) => {
      const fineTuneStepIndex =
        prevSteps.findIndex((step) => step.label === "Step 2") + 1;
      const fineTuneStep = {
        label: "Fine-Tune Step",
        description: "Link to Fine Tuner",
      };
      if (!prevSteps.some((step) => step.label === "Fine-Tune Step")) {
        return [
          ...prevSteps.slice(0, fineTuneStepIndex),
          fineTuneStep,
          ...prevSteps.slice(fineTuneStepIndex),
        ];
      }
      return prevSteps;
    });
  };

  const removeDynamicSteps = () => {
    setSteps((prevSteps) =>
      prevSteps.filter(
        (step) =>
          step.label !== "Custom Step" && step.label !== "Fine-Tune Step"
      )
    );
  };

  const handleDeploy = async () => {
    const model_id = selectedModel || "0";
    const weights_id =
      selectedWeight === "Default Weights"
        ? ""
        : customWeight?.weights_id || selectedWeight;

    const payload = JSON.stringify({
      model_id,
      weights_id,
    });

    console.log("Deploying model with:", payload);
    try {
      const response = await axios.post(deployUrl, payload, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      console.log("Deployment response:", response);
      customToast.success("Model deployment started!");
    } catch (error) {
      console.error("Error during deployment:", error);
      customToast.error("Deployment failed!");
    }
  };

  return (
    <div className="flex flex-col gap-8 w-3/4 mx-auto max-w-7xl px-4 md:px-8 pt-10 py-6">
      <CustomToaster />
      <Card className="h-auto py-8 px-16 ">
        <Stepper variant="circle-alt" initialStep={0} steps={steps}>
          {steps.map((stepProps) => {
            switch (stepProps.label) {
              case "Step 1":
                return (
                  <Step key={stepProps.label} {...stepProps} className="mb-8">
                    <FirstStepForm setSelectedModel={setSelectedModel} />
                  </Step>
                );
              case "Step 2":
                return (
                  <Step key={stepProps.label} {...stepProps} className="mb-8">
                    <SecondStepForm
                      selectedModel={selectedModel}
                      setSelectedWeight={setSelectedWeight}
                      addCustomStep={addCustomStep}
                      addFineTuneStep={addFineTuneStep}
                      removeDynamicSteps={removeDynamicSteps}
                    />
                  </Step>
                );
              case "Custom Step":
                return (
                  <Step key={stepProps.label} {...stepProps}>
                    <div className="py-8 px-16">
                      {/* <Card> */}
                      <WeightForm
                        selectedModel={selectedModel}
                        setCustomWeight={setCustomWeight}
                      />
                      {/* <UploadDialog /> */}
                      {/* </Card>
                      // <UploadDialog /> */}
                    </div>
                  </Step>
                );
              case "Fine-Tune Step":
                return (
                  <Step key={stepProps.label} {...stepProps}>
                    <div className="flex flex-col items-center w-full justify-center p-10">
                      <Button
                        onClick={() =>
                          customToast.success("Link to Fine Tuner activated")
                        }
                      >
                        Link to Fine Tuner
                      </Button>
                    </div>
                    <StepperFormActions
                      form={null}
                      removeDynamicSteps={removeDynamicSteps}
                    />
                  </Step>
                );
              case "Final Step":
                return (
                  <Step key={stepProps.label} {...stepProps}>
                    <DeployModelStep
                      selectedModel={selectedModel}
                      selectedWeight={selectedWeight}
                      customWeight={customWeight}
                      handleDeploy={handleDeploy}
                    />
                  </Step>
                );
              default:
                return null;
            }
          })}
          <div className="py-12">
            <MyStepperFooter removeDynamicSteps={removeDynamicSteps} />
          </div>
        </Stepper>
      </Card>
    </div>
  );
}

const FirstFormSchema = z.object({
  model: z.string().nonempty("Please select a model."),
});

function FirstStepForm({
  setSelectedModel,
}: {
  setSelectedModel: (model: string) => void;
}) {
  const { nextStep } = useStepper();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [models, setModels] = useState<Model[]>([]);

  useEffect(() => {
    console.log("fetching models", getModelsUrl);
    const fetchModels = async () => {
      try {
        const response = await axios.get<Model[]>(getModelsUrl);
        console.log("fetched models:", response.data);
        setModels(response.data);
      } catch (error) {
        console.error("Error fetching models:", error);
      }
    };

    fetchModels();
  }, []);

  const form = useForm<z.infer<typeof FirstFormSchema>>({
    resolver: zodResolver(FirstFormSchema),
    defaultValues: {
      model: "",
    },
  });

  const onSubmit = async (data: z.infer<typeof FirstFormSchema>) => {
    setIsSubmitting(true);
    try {
      const selectedModel = models.find((model) => model.name === data.model);
      if (selectedModel) {
        setSelectedModel(selectedModel.id);
        customToast.success("Model Selected!: " + selectedModel.name);
        nextStep();
      } else {
        customToast.error("Model not found!; Ran into error :(");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit(onSubmit)();
        }}
        className="space-y-10"
      >
        <FormField
          control={form.control}
          name="model"
          render={({ field }) => (
            <FormItem className="w-full mb-4 p-8">
              <FormLabel className="text-lg font-semibold text-gray-800 dark:text-white ">
                Models
              </FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {models.map((model) => (
                    <SelectItem key={model.id} value={model.name}>
                      {model.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage className="text-red-500 dark:text-red-300" />
            </FormItem>
          )}
        />
        <StepperFormActions
          form={form}
          removeDynamicSteps={() => {}}
          isSubmitting={isSubmitting}
        />
      </form>
    </Form>
  );
}

const SecondFormSchema = z.object({
  weight: z.string().nonempty("Please select a weight."),
});

function SecondStepForm({
  selectedModel,
  setSelectedWeight,
  addCustomStep,
  addFineTuneStep,
  removeDynamicSteps,
}: SecondStepFormProps & {
  setSelectedWeight: (weight: string) => void;
  selectedModel: string | null;
}) {
  const { nextStep } = useStepper();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const form = useForm<z.infer<typeof SecondFormSchema>>({
    resolver: zodResolver(SecondFormSchema),
    defaultValues: {
      weight: "",
    },
  });

  const onSubmit = async (data: z.infer<typeof SecondFormSchema>) => {
    setIsSubmitting(true);
    try {
      console.log("Form data:", data);
      if (data.weight) {
        setSelectedWeight(data.weight);
        customToast.success("Model Weights Selected!");
        nextStep();
      } else {
        customToast.error("Weight not found!");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit(onSubmit)();
        }}
        className="space-y-6"
      >
        <FormField
          control={form.control}
          name="weight"
          render={({ field }) => (
            <FormItem className="w-full mb-4 p-8">
              <FormLabel className="text-lg font-semibold text-gray-800 dark:text-white">
                Weight
              </FormLabel>
              <Select
                onValueChange={(value) => {
                  field.onChange(value);
                  removeDynamicSteps();
                  if (value === "Custom Weight") {
                    addCustomStep();
                  } else if (value === "Fine-Tune Weights") {
                    addFineTuneStep();
                  }
                }}
                defaultValue={field.value}
              >
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a weight" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="Default Weights">
                    Default Weights
                  </SelectItem>
                  <SelectItem value="Custom Weight">Custom Weight</SelectItem>
                  <SelectItem value="Fine-Tune Weights">
                    Fine-Tune Weights
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormMessage className="text-red-500 dark:text-red-300" />
            </FormItem>
          )}
        />
        <StepperFormActions
          form={form}
          removeDynamicSteps={removeDynamicSteps}
          isSubmitting={isSubmitting}
        />
      </form>
    </Form>
  );
}

function WeightForm({
  selectedModel,
  setCustomWeight,
}: {
  selectedModel: string | null;
  setCustomWeight: (weight: Weight) => void;
}) {
  const { nextStep } = useStepper();
  const [weights, setWeights] = useState<Weight[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (selectedModel) {
      console.log("fetching weights", getWeightsUrl(selectedModel));
      const fetchWeights = async () => {
        try {
          const response = await axios.get<Weight[]>(
            getWeightsUrl(selectedModel)
          );
          console.log("fetched weights:", response.data);
          setWeights(response.data);
        } catch (error) {
          console.error("Error fetching weights:", error);
        }
      };

      fetchWeights();
    }
  }, [selectedModel]);

  const form = useForm({
    resolver: zodResolver(
      z.object({
        weight: z.string().nonempty("Please select a weight file."),
      })
    ),
    defaultValues: {
      weight: "",
    },
  });

  const onSubmit = async (data: { weight: string }) => {
    setIsSubmitting(true);
    try {
      const selectedWeight = weights.find(
        (weight) => weight.name === data.weight
      );
      if (selectedWeight) {
        setCustomWeight(selectedWeight);
        customToast.success("Model Weight Selected!");
        nextStep();
      } else {
        customToast.error("Weight not found!");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Form {...form}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit(onSubmit)();
        }}
        className="space-y-6"
      >
        <FormField
          control={form.control}
          name="weight"
          render={({ field }) => (
            <FormItem className="w-full mb-4 p-8">
              <FormLabel className="text-lg font-semibold text-gray-800 dark:text-white">
                Weight
              </FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a weight" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {weights.map((weight) => (
                    <SelectItem key={weight.weights_id} value={weight.name}>
                      {weight.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage className="text-red-500 dark:text-red-300" />
            </FormItem>
          )}
        />
        <StepperFormActions
          form={form}
          removeDynamicSteps={() => {}}
          isSubmitting={isSubmitting}
        />
      </form>
    </Form>
  );
}

// StepperFormActions Component
function StepperFormActions({
  form,
  removeDynamicSteps,
  isSubmitting,
}: {
  form: any;
  removeDynamicSteps: () => void;
  isSubmitting?: boolean;
}) {
  const {
    prevStep,
    nextStep,
    resetSteps,
    isDisabledStep,
    hasCompletedAllSteps,
    isOptionalStep,
    activeStep,
    steps,
  } = useStepper();

  const customPrevStep = () => {
    const currentStepLabel = steps[activeStep]?.label;
    if (
      currentStepLabel === "Custom Step" ||
      currentStepLabel === "Fine-Tune Step"
    ) {
      removeDynamicSteps();
    }
    prevStep();
  };

  return (
    <div className="w-full flex justify-end gap-2">
      {hasCompletedAllSteps ? (
        <Button
          size="sm"
          onClick={() => {
            removeDynamicSteps();
            resetSteps();
          }}
        >
          Reset
        </Button>
      ) : (
        <>
          <Button
            disabled={isDisabledStep || activeStep === 0 || isSubmitting}
            onClick={customPrevStep}
            size="sm"
            variant="secondary"
          >
            Prev
          </Button>
          {activeStep < steps.length - 1 && (
            <Button
              size="sm"
              type={form ? "submit" : "button"}
              disabled={isSubmitting}
              onClick={!form ? nextStep : undefined}
            >
              {isOptionalStep ? "Skip" : "Next"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function DeployModelStep({
  selectedModel,
  selectedWeight,
  customWeight,
  handleDeploy,
}: {
  selectedModel: string | null;
  selectedWeight: string | null;
  customWeight: Weight | null;
  handleDeploy: () => void;
}) {
  const { nextStep } = useStepper();

  const onDeploy = async () => {
    await handleDeploy();
    console.log("ensure code reaches here");
    nextStep();
  };

  return (
    <>
      <div className="flex flex-col items-center justify-center p-10">
        <Button onClick={onDeploy}>Deploy Model</Button>
      </div>
      <StepperFormActions form={null} removeDynamicSteps={() => {}} />
    </>
  );
}

function MyStepperFooter({
  removeDynamicSteps,
}: {
  removeDynamicSteps: () => void;
}) {
  const { hasCompletedAllSteps, resetSteps } = useStepper();

  const handleReset = () => {
    removeDynamicSteps();
    resetSteps();
  };

  if (!hasCompletedAllSteps) {
    return null;
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <Button onClick={handleReset}>Reset and Deploy Another Model!</Button>
    </div>
  );
}
