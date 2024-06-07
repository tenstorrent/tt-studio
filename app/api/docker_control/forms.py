# docker_control/forms.py
from django import forms
from shared_config.model_config import model_implmentations


class DockerForm(forms.Form):
    DOCKER_IMAGES = (
        (impl_key, impl.model_name) for impl_key, impl in model_implmentations.items()
    )
    impl_id = forms.ChoiceField(choices=DOCKER_IMAGES, label="Select Docker Image")
